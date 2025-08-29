const player = document.getElementById('player');
const playerContainer = document.getElementById('playerContainer');
const categoriesBtn = document.getElementById('categoriesBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const playPauseBtn = document.getElementById('playPauseBtn');
const volumeSlider = document.getElementById('volumeSlider');
const searchInput = document.getElementById('searchInput');
const randomBtn = document.getElementById('randomBtn');
const backBtn = document.getElementById('backBtn');
const currentLogo = document.getElementById('currentLogo');
const currentTitle = document.getElementById('currentTitle');
const currentCapital = document.getElementById('currentCapital');
const currentTime = document.getElementById('currentTime');
const list = document.getElementById('channelList');

let countries = {};
let channels = [];
let hls = null;
let currentTimezone = null;
let currentChannelIndex = null;
let currentCountry = undefined;
let currentCategory = null;

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
        if (currentTimezone) {
          currentTime.textContent = getTimeByTimezone(currentTimezone);
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
				groupTitle: ch.groupTitle,
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

// === Обработчик кнопки Categories ===
categoriesBtn.onclick = () => {
  currentCountry = 'categories';
  backBtn.style.display = 'block';
  categoriesBtn.style.display = 'none';
  searchInput.placeholder = "Filter Categories";
  searchInput.value = '';
  searchInput.focus();
  renderCategories();
};

function renderCategories(filter = '') {
  list.innerHTML = '';
  list.scrollTop = 0;
  currentCategory = null;

  // Добавляем пункт "All Channels" в начало
  const allDiv = document.createElement('div');
  allDiv.className = 'channel';
  allDiv.dataset.type = 'all';
  allDiv.textContent = 'All Channels';
  allDiv.onclick = () => {
    searchInput.value = '';
    searchInput.focus();
    renderAllChannels();
  };
  list.appendChild(allDiv);

  const categorySet = new Set();
  channels.forEach(ch => {
    if (!ch.groupTitle) return;
    ch.groupTitle.split(';').forEach(cat => {
      const trimmed = cat.trim();
      if (trimmed && trimmed.toLowerCase().includes(filter.toLowerCase())) {
        categorySet.add(trimmed);
      }
    });
  });

  const categories = Array.from(categorySet).sort((a,b) => a.localeCompare(b, 'en', {sensitivity: 'base'}));

  categories.forEach(cat => {
    const div = document.createElement('div');
    div.className = 'channel';
    div.dataset.type = 'category';
    div.textContent = cat;

    div.onclick = () => {
      currentCategory = cat;
      renderChannelsByCategory(cat);
	  searchInput.value = '';
      searchInput.focus();
    };

    list.appendChild(div);
  });
}

function renderChannelsByCategory(category, filter='') {
  list.innerHTML = '';
  list.scrollTop = 0;
  currentCategory = category;

  const filtered = channels.filter(ch =>
    ch.groupTitle &&
    ch.groupTitle.split(';').map(c => c.trim()).includes(category) &&
    ch.displayName.toLowerCase().includes(filter)
  );

  filtered.forEach(ch => {
    const div = document.createElement('div');
    div.className = 'channel';
    div.dataset.type = 'channel';
    div.dataset.index = channels.indexOf(ch);

    const spanFlag = document.createElement('span');
    spanFlag.className = 'channel-flag';
    spanFlag.textContent = ch.flag; // сначала ставим текст

    const spanText = document.createElement('span');
    spanText.className = 'channel-text';
    spanText.textContent = ch.displayName;

    div.appendChild(spanFlag);
    div.appendChild(spanText);

    div.onclick = () => playChannel(channels.indexOf(ch), div, ch);

    list.appendChild(div);
  });

  if (window.twemoji) {
    try {
      twemoji.parse(list, { folder: 'svg', ext: '.svg' });
    } catch (e) { console.warn("twemoji parse error", e); }
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
	  renderChannels(fObj.flag);

	  searchInput.value = '';
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

function renderAllChannels(filter = '') {
  currentCountry = 'all';
  backBtn.style.display = 'block';
  categoriesBtn.style.display = 'none';
  searchInput.placeholder = "Filter Channels";
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
}

/* Воспроизведение */
function playChannel(index, element, channelObj) {
  document.querySelectorAll('.channel').forEach(el => el.classList.remove('active'));
  if (element) element.classList.add('active');

  const ch = (channelObj ? channelObj : channels[index]);
  if (!ch || !ch.url) return;

  // Надёжно определяем индекс и сохраняем его
  const resolvedIndex = (typeof index === 'number' && index >= 0) ? index : channels.indexOf(ch);
  currentChannelIndex = resolvedIndex;

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

function updateNowPlayingUI(channelObj) {
  if (channelObj.logo) {
    currentLogo.src = channelObj.logo;
    currentLogo.style.visibility = 'visible';

    // если картинка не загрузится → подставляем дефолт
    currentLogo.onerror = () => {
      currentLogo.onerror = null; // чтобы не зациклиться
      currentLogo.src = '../images/logo.svg'; // путь к твоему файлу
    };
  } else {
    // если логотипа вообще нет, сразу ставим дефолт
    currentLogo.src = '../images/logo.svg';
    currentLogo.style.visibility = 'visible';
  }

  // ищем родительскую страну
  let parentCountry = countries[channelObj.flag];
  let childCountry = parentCountry;

  for (const flag in countries) {
    if (countries[flag].dependencies && countries[flag].dependencies[channelObj.flag]) {
      parentCountry = countries[flag];
      childCountry = countries[flag].dependencies[channelObj.flag];
      break;
    }
  }

  currentTitle.textContent = parentCountry?.name || '';
  currentCapital.textContent = childCountry?.capital || '';

  const tz = childCountry?.timezone || parentCountry?.timezone;
  currentTime.textContent = getTimeByTimezone(tz);
}

searchInput.addEventListener('input', () => {
  const filter = searchInput.value.trim().toLowerCase();

  if (currentCountry === undefined) {
    renderCountries(filter);
  } else if (currentCountry === 'all') {
    renderAllChannels(filter);
  } else if (currentCountry === 'categories') {
    if (currentCategory) {
      renderChannelsByCategory(currentCategory, filter);
    } else {
      renderCategories(filter);
    }
  } else {
    renderChannels(currentCountry, filter);
  }
});

/* Кнопка возврата к списку стран */
backBtn.addEventListener('click', () => {
  categoriesBtn.style.display = 'block';
  searchInput.value = '';
  searchInput.focus();
  renderCountries('');
});

/* Случайный выбор */
randomBtn.onclick = () => {

  const visible = Array.from(document.querySelectorAll('#channelList .channel'));
  if (visible.length === 0) return;

  const channelEls = visible.filter(el => el.dataset.type === 'channel');
  if (channelEls.length > 0) {
    const pool = channelEls.filter(el => parseInt(el.dataset.index, 10) !== currentChannelIndex);
    if (pool.length === 0) return; // нечего выбирать, единственный канал = текущий

    const idxVisible = Math.floor(Math.random() * pool.length);
    const el = pool[idxVisible];
    el.scrollIntoView({ behavior: 'auto', block: 'start' });

    const chIndex = parseInt(el.dataset.index, 10);
    const ch = channels[chIndex];
    if (ch) playChannel(chIndex, el, ch);

	searchInput.value = '';
    searchInput.focus();
    return;
  }

  // если видимых каналов нет — как и раньше, случайная страна
  const countryEls = visible.filter(el => el.dataset.type === 'country');
  if (countryEls.length === 0) return;
  const idxCountry = Math.floor(Math.random() * countryEls.length);
  const countryEl = countryEls[idxCountry];
  countryEl.click();

  searchInput.value = '';
  searchInput.focus();
};

// Play / Pause
playPauseBtn.onclick = () => {
  if (player.paused) {
    player.play();
  } else {
    player.pause();
  }
};
player.onplay = () => playPauseBtn.textContent = '❚❚';
player.onpause = () => playPauseBtn.textContent = '▶';

// Volume
volumeSlider.oninput = () => player.volume = volumeSlider.value;

// Fullscreen
function updateFullscreenIcon() {
  const iconUrl = document.fullscreenElement ? '../images/fullscreen-exit.svg' : '../images/fullscreen-enter.svg';
  fullscreenBtn.style.backgroundImage = `url('${iconUrl}')`;
}

fullscreenBtn.onclick = () => {
  if (!document.fullscreenElement) {
    playerContainer.requestFullscreen().catch(err => console.log(err));
  } else {
    document.exitFullscreen();
  }
  updateFullscreenIcon(); // на случай клика
};

// Событие для выхода/входа в fullscreen (включая ESC)
document.addEventListener('fullscreenchange', updateFullscreenIcon);
