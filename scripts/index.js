const list = document.getElementById('channelList');
const player = document.getElementById('videoPlayer');
const searchInput = document.getElementById('searchInput');
const randomBtn = document.getElementById('randomBtn');
const backBtn = document.getElementById('backBtn');
const currentLogo = document.getElementById('currentLogo');
const currentTitle = document.getElementById('currentTitle');
const currentCapital = document.getElementById('currentCapital');
const currentTime = document.getElementById('currentTime');

let countries = {};
let channels = [];
let hls = null;
let currentCountry = undefined; // undefined => показываем список стран, иначе показываем каналы этой страны

/* Очистка имени канала */
function cleanName(name) {
  return name
    .replace(/\[Not 24\/7\]/gi, '🕛')
    .replace(/\[Geo-blocked\]/gi, '🌐')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Удаление всего содержимого в круглых скобках */
function stripQuality(name) {
  return name.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
}

function getTimeByTimezone(tz) {
  if (!tz) return '';
  const match = tz.match(/UTC([+-]\d{2}):(\d{2})/);
  if (!match) return '';
  const offsetHours = parseInt(match[1], 10);
  const offsetMinutes = parseInt(match[2], 10);

  const now = new Date();
  // текущее UTC время
  const utc = new Date(now.getTime() + now.getTimezoneOffset() * 60000);
  utc.setHours(utc.getHours() + offsetHours);
  utc.setMinutes(utc.getMinutes() + offsetMinutes);

  let hours = utc.getHours();
  const minutes = utc.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;

  return `${hours.toString().padStart(2,'0')}:${minutes.toString().padStart(2,'0')} ${ampm}`;
}

function getFlagByTvgId(tvgId) {
  if (!tvgId) return undefined;
  const m = tvgId.toLowerCase().match(/\.([a-z]{2,})/);
  if (!m) return undefined;
  const code = m[1].replace(/[^a-z]/g, '');

  for (const flag in countries) {
    const country = countries[flag];
    if (country.domain === code) return flag;

    // поиск в зависимостях
    if (country.dependencies) {
      for (const depFlag in country.dependencies) {
        if (country.dependencies[depFlag].domain === code) return depFlag;
      }
    }
  }

  return undefined;
}

searchInput.addEventListener('input', () => {
  const filter = searchInput.value.trim().toLowerCase();

  if (currentCountry === undefined) {
    // список стран
    renderCountries(filter);
  } else if (currentCountry === 'all') {
    // все каналы
    renderAllChannels(filter);
  } else {
    // каналы выбранной страны
    renderChannels(currentCountry, filter);
  }
});

function renderAllChannels(filter = '') {
  currentCountry = 'all';
  backBtn.style.display = 'block';
  allChannelsBtn.style.display = 'none';
  searchInput.placeholder = "Filter Channels";
  searchInput.focus();
  list.innerHTML = '';
  list.scrollTop = 0;

  const sorted = channels
    .filter(ch => ch.flag && ch.displayName.toLowerCase().includes(filter))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'en', {sensitivity: 'base'}));

  sorted.forEach(ch => {
    const div = document.createElement('div');
    div.className = 'channel';
    div.dataset.type = 'channel';
    div.dataset.index = channels.indexOf(ch);

    const spanFlag = document.createElement('span');
    spanFlag.className = 'channel-flag';
    spanFlag.textContent = ch.flag;

    const spanText = document.createElement('span');
    spanText.className = 'channel-text';
    spanText.textContent = ch.displayName;

    div.appendChild(spanFlag);
    div.appendChild(spanText);

    div.onclick = () => playChannel(channels.indexOf(ch), div, ch);

    list.appendChild(div);
  });

  if (window.twemoji) {
    try { twemoji.parse(list, {folder: 'svg', ext: '.svg'}); }
    catch (e) { console.warn("twemoji parse error", e); }
  }

  // Случайный выбор канала из списка
  const channelEls = Array.from(list.querySelectorAll('.channel[data-type="channel"]'));
  if (channelEls.length > 0) {
    const randomIdx = Math.floor(Math.random() * channelEls.length);
    const el = channelEls[randomIdx];
    el.scrollIntoView({ behavior: 'auto', block: 'start' }); // прокрутка в верх списка
    const chIndex = parseInt(el.dataset.index, 10);
    const ch = channels[chIndex];
    if (ch) playChannel(chIndex, el, ch);
  }
}

// и заменяем твой обработчик кнопки "All Channels" на:
allChannelsBtn.onclick = () => renderAllChannels();

/* Загрузка плейлиста */
async function loadPlaylist(url) {
  try {
    const res = await fetch(url);
    const text = await res.text();
    parsePlaylist(text);
  } catch (e) {
    alert("Playlist Loading Error");
    console.error(e);
  }
}

/* Парсинг m3u */
function parsePlaylist(text) {
  const lines = text.split(/\r?\n/);
  channels = [];
  let currentName = '';
  let currentTvgId = '';
  let currentLogoUrl = '';

  for (let line of lines) {
    if (line.startsWith('#EXTINF')) {
      let name = line.split(',').slice(1).join(',');
      currentName = cleanName(name);
      const mId = line.match(/tvg-id="([^"]+)"/i);
      currentTvgId = mId ? mId[1] : '';
      const mLogo = line.match(/tvg-logo="([^"]+)"/i);
      currentLogoUrl = mLogo ? mLogo[1] : '';
    } else if (line && !line.startsWith('#')) {
      if (currentName) {
        const flag = getFlagByTvgId(currentTvgId);
        if (!flag) { // пропускаем каналы без флага
          currentName = '';
          currentTvgId = '';
          currentLogoUrl = '';
          continue;
        }
        const displayName = stripQuality(currentName);
        channels.push({
          name: currentName,
          displayName,
          url: line,
          tvgId: currentTvgId,
          logo: currentLogoUrl,
          flag
        });
      }
      currentName = '';
      currentTvgId = '';
      currentLogoUrl = '';
    }
  }
}

/* Рендер списка стран (только те страны, для которых есть каналы) */
function renderCountries(filter = '') {
  currentCountry = undefined;
  backBtn.style.display = 'none';
  searchInput.placeholder = "Filter Countries";
  list.innerHTML = '';
  list.scrollTop = 0;

  const flagSet = new Set();
  channels.forEach(c => {
    if (!c.flag) return;
    let parentFlag = c.flag;

    // если это зависимая территория — берём её родителя
    for (const flag in countries) {
      if (countries[flag].dependencies && countries[flag].dependencies[c.flag]) {
        parentFlag = flag;
        break;
      }
    }

    flagSet.add(parentFlag);
  });

  let flags = Array.from(flagSet).map(f => ({
    flag: f,
    name: countries[f]?.name || f
  }));

  // алфавитная сортировка стран
  flags.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

  // фильтруем только по названию страны
  flags = flags.filter(fObj => fObj.name.toLowerCase().includes(filter.toLowerCase()));

  flags.forEach((fObj) => {
    const div = document.createElement('div');
    div.className = 'channel';
    div.dataset.type = 'country';
    div.dataset.flag = fObj.flag;

    const spanFlag = document.createElement('span');
    spanFlag.className = 'channel-flag';
    spanFlag.textContent = fObj.flag;

    const spanText = document.createElement('span');
    spanText.className = 'channel-text';
    spanText.textContent = fObj.name;

    div.appendChild(spanFlag);
    div.appendChild(spanText);

    div.onclick = () => {
      searchInput.value = '';
      renderChannels(fObj.flag);

      const firstChannelEl = list.querySelector('.channel[data-type="channel"]');
      if (firstChannelEl) {
        const idx = parseInt(firstChannelEl.dataset.index, 10);
        const ch = channels[idx];
        if (ch) playChannel(idx, firstChannelEl, ch);
      }
      searchInput.focus();
    };

    list.appendChild(div);
  });

  if (window.twemoji) {
    try { twemoji.parse(list, {folder: 'svg', ext: '.svg'}); } 
    catch (e) { console.warn("twemoji parse error", e); }
  }
}

function renderChannels(countryFlag, filter = '') {
  currentCountry = countryFlag;
  backBtn.style.display = 'block';
  searchInput.placeholder = "Filter Channels";
  list.innerHTML = '';
  list.scrollTop = 0;

  // список флагов, которые относятся к выбранной стране
  let validFlags = [countryFlag];

  // если у страны есть зависимости — добавляем их
  if (countries[countryFlag]?.dependencies) {
    validFlags = validFlags.concat(Object.keys(countries[countryFlag].dependencies));
  }

  const filtered = channels.filter(ch => {
    if (!ch.flag) return false;
    // проверяем, принадлежит ли канал стране или её зависимым
    if (!validFlags.includes(ch.flag)) return false;
    return ch.displayName.toLowerCase().includes(filter.toLowerCase());
  });

  filtered.forEach((ch, idx) => {
    const div = document.createElement('div');
    div.className = 'channel';
    div.dataset.type = 'channel';
    div.dataset.index = channels.indexOf(ch);

    const spanFlag = document.createElement('span');
    spanFlag.className = 'channel-flag';
    spanFlag.textContent = ch.flag;

    const spanText = document.createElement('span');
    spanText.className = 'channel-text';
    spanText.textContent = ch.displayName;

    div.appendChild(spanFlag);
    div.appendChild(spanText);

    div.onclick = () => playChannel(channels.indexOf(ch), div, ch);

    list.appendChild(div);
  });

  if (window.twemoji) {
    try { twemoji.parse(list, {folder: 'svg', ext: '.svg'}); }
    catch (e) { console.warn("twemoji parse error", e); }
  }
}

function updateNowPlayingUI(channelObj) {
  if (channelObj.logo) {
    currentLogo.src = channelObj.logo;
    currentLogo.style.visibility = 'visible';
  } else {
    currentLogo.removeAttribute('src');
    currentLogo.style.visibility = 'hidden';
  }

  // ищем родительскую страну
  let parentCountry = countries[channelObj.flag];
  let childCountry = parentCountry;

  // если это зависимая территория, берем родителя
  for (const flag in countries) {
    if (countries[flag].dependencies && countries[flag].dependencies[channelObj.flag]) {
      parentCountry = countries[flag];
      childCountry = countries[flag].dependencies[channelObj.flag];
      break;
    }
  }

  // название страны (родителя) и столица / название вложенной страны
  currentTitle.textContent = parentCountry?.name || '';
  currentCapital.textContent = childCountry?.capital || '';
  currentTime.textContent = getTimeByTimezone(parentCountry?.timezone);
}

/* Воспроизведение */
function playChannel(index, element, channelObj) {
  document.querySelectorAll('.channel').forEach(el => el.classList.remove('active'));
  if (element) element.classList.add('active');

  const ch = (channelObj ? channelObj : channels[index]);
  if (!ch || !ch.url) return;

  updateNowPlayingUI(ch);

  if (Hls.isSupported()) {
    if (!hls) hls = new Hls();
    else hls.detachMedia();
    hls.loadSource(ch.url);
    hls.attachMedia(player);
    hls.on(Hls.Events.MANIFEST_PARSED, function() {
      player.play().catch(()=>{});
    });
  } else if (player.canPlayType('application/vnd.apple.mpegurl')) {
    player.src = ch.url;
    player.play().catch(()=>{});
  } else {
    alert("Ваш браузер не поддерживает HLS");
  }
}

/* Загрузка channels.json при старте */
window.addEventListener('DOMContentLoaded', () => {
  searchInput.value = '';
  searchInput.focus();

  fetch("data/countries.json")
    .then(r => r.json())
    .then(data => {
      countries = data;
	  
	  // Теперь можно запускать setInterval для обновления времени
      setInterval(() => {
        if (currentCountry) {
          const country = countries[currentCountry];
          if (country) currentTime.textContent = getTimeByTimezone(country.timezone);
        }
      }, 1000);

      // После того как countries загружены, можно грузить плейлист
      fetch("data/channels.json")
        .then(r => r.json())
        .then(data => {
          channels = data
            .filter(ch => ch.working)
            .map(ch => {
              const flag = getFlagByTvgId(ch.tvgId);
              return {
                name: ch.name,
                displayName: stripQuality(cleanName(ch.name)),
                url: ch.url,
                tvgId: ch.tvgId,
                logo: ch.tvgLogo,
                flag
              };
            });
          
          renderCountries();
        })
        .catch(e => {
          console.error("Ошибка загрузки channels.json", e);
        });

    })
    .catch(e => {
      console.error("Ошибка загрузки countries.json", e);
    });
});

/* Кнопка возврата к списку стран */
backBtn.addEventListener('click', () => {
  allChannelsBtn.style.display = 'block';
  searchInput.value = '';
  searchInput.focus();
  renderCountries('');
});

/* Случайный выбор */
randomBtn.onclick = () => {
  searchInput.focus();
  // Обновляем видимые элементы
  const visible = Array.from(document.querySelectorAll('#channelList .channel'));
  if (visible.length === 0) return;

  // Сначала ищем видимые каналы (если есть), иначе выбираем страну
  const channelEls = visible.filter(el => el.dataset.type === 'channel');
  if (channelEls.length > 0) {
    const idxVisible = Math.floor(Math.random() * channelEls.length);
    const el = channelEls[idxVisible];
    // Прокрутка выбранного канала В САМЫХ ВЕРХУ списка
    el.scrollIntoView({ behavior: 'auto', block: 'start' });

    const chIndex = parseInt(el.dataset.index, 10);
    const ch = channels[chIndex];
    if (ch) {
      playChannel(chIndex, el, ch);
    }
    return;
  }

  // Нет видимых каналов — выбираем случайную страну (и открываем её)
  const countryEls = visible.filter(el => el.dataset.type === 'country');
  if (countryEls.length === 0) return;
  const idxCountry = Math.floor(Math.random() * countryEls.length);
  const countryEl = countryEls[idxCountry];
  countryEl.click();

  searchInput.value = '';
  searchInput.focus();
};
