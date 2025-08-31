const playerContainer = document.getElementById('playerContainer');
const player = document.getElementById('player');
const searchInput = document.getElementById('searchInput');
const favoriteIcon = document.getElementById("favoriteIcon");
const favoriteBtn = document.getElementById("favoriteBtn");
const randomBtn = document.getElementById('randomBtn');
const categoriesBtn = document.getElementById('categoriesBtn');
const backBtn = document.getElementById('backBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const playPauseBtn = document.getElementById('playPauseBtn');
const volumeBtn = document.getElementById('volumeBtn');
const volumeSlider = document.getElementById('volumeSlider');
const controls = document.getElementById('controls');
const currentTitle = document.getElementById('currentTitle');
const currentCapital = document.getElementById('currentCapital');
const currentTime = document.getElementById('currentTime');
const list = document.getElementById('channelList');

let currentCountry = undefined;
let savedVolume = 1;
let favorites = {};
let countries = {};
let channels = [];
let preview = null;
let hls = null;
let currentChannel = null;
let currentTimezone = null;
let currentCategory = null;
let currentChannelIndex = null;

loadFavorites();

/* Очистка имени канала */
function cleanName(name) {
  return name
    .replace(/\[Not 24\/7\]/gi, '<img src="images/time-lock.svg" alt="Not 24/7" class="icon">')
    .replace(/\[Geo-blocked\]/gi, '<img src="images/globe-lock.svg" alt="Geo-blocked" class="icon">')
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

function saveFavorites() {
  const obj = {};
  for (const cat in favorites) {
    obj[cat] = [...favorites[cat]];
  }
  localStorage.setItem("favorites", JSON.stringify(obj));
}

function loadFavorites() {
  const data = localStorage.getItem("favorites");
  if (data) {
    const obj = JSON.parse(data);
    for (const cat in obj) {
      favorites[cat] = new Set(obj[cat]);
    }
  }
}

/* Загрузка channels.json при старте */
window.addEventListener('DOMContentLoaded', () => {
  const stored = localStorage.getItem('playerVolume');
  const v = stored !== null ? parseFloat(stored) : 1;
  setVolume(v);

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
              let flag = getFlagByTvgId(ch.tvgId);
			  let groupTitle = ch.groupTitle;

			  if (!ch.tvgId || !flag) {
			    flag = "🏴‍☠️";
			    groupTitle = "Undefined";
			  }

              return {
                name: ch.name,
                displayName: stripQuality(cleanName(ch.name)),
                url: ch.url,
                tvgId: ch.tvgId,
                logo: ch.tvgLogo,
				groupTitle,
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

function renderCategories(filter = '') {
  list.innerHTML = '';
  list.scrollTop = 0;
  currentCategory = null;

  currentTitle.removeAttribute('data-category');
  currentCapital.textContent = 'TV Around';
  currentTime.textContent = 'The World';
  currentTitle.textContent = 'Internet Protocol TV';

  // Добавляем пункт "All Channels"
  if ('all channels'.toLowerCase().includes(filter.toLowerCase())) {
    const allDiv = document.createElement('div');
    allDiv.className = 'channel';
    allDiv.dataset.type = 'all';
    allDiv.textContent = 'All Channels';

    // Клик по самой категории — обычный рендер
    allDiv.onclick = () => {
      searchInput.value = '';
      searchInput.focus();
      renderAllChannels();
    };

    const favBtn = document.createElement("button");

	favBtn.innerHTML = `
	<svg id="favoriteIcon" width="800px" height="800px" viewBox="0 0 1920 1920" xmlns="http://www.w3.org/2000/svg">
	  <path d="M1915.918 737.475c-10.955-33.543-42.014-56.131-77.364-56.131h-612.029l-189.063-582.1v-.112C1026.394 65.588 995.335 43 959.984 43c-35.237 0-66.41 22.588-77.365 56.245L693.443 681.344H81.415c-35.35 0-66.41 22.588-77.365 56.131-10.955 33.544.79 70.137 29.478 91.03l495.247 359.831-189.177 582.212c-10.955 33.657 1.13 70.25 29.817 90.918 14.23 10.278 30.946 15.487 47.66 15.487 16.716 0 33.432-5.21 47.775-15.6l495.134-359.718 495.021 359.718c28.574 20.781 67.087 20.781 95.662.113 28.687-20.668 40.658-57.261 29.703-91.03l-189.176-582.1 495.36-359.83c28.574-20.894 40.433-57.487 29.364-91.03" fill-rule="evenodd"/>
	</svg>`;

    favBtn.onclick = (e) => {
      e.stopPropagation(); // чтобы не сработал переход в All Channels
      renderFavoritesByCategory("All Channels");
    };
    allDiv.appendChild(favBtn);

    list.appendChild(allDiv);
  }

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

    const favBtn = document.createElement("button");

	favBtn.innerHTML = `
	<svg id="favoriteIcon" width="800px" height="800px" viewBox="0 0 1920 1920" xmlns="http://www.w3.org/2000/svg">
	  <path d="M1915.918 737.475c-10.955-33.543-42.014-56.131-77.364-56.131h-612.029l-189.063-582.1v-.112C1026.394 65.588 995.335 43 959.984 43c-35.237 0-66.41 22.588-77.365 56.245L693.443 681.344H81.415c-35.35 0-66.41 22.588-77.365 56.131-10.955 33.544.79 70.137 29.478 91.03l495.247 359.831-189.177 582.212c-10.955 33.657 1.13 70.25 29.817 90.918 14.23 10.278 30.946 15.487 47.66 15.487 16.716 0 33.432-5.21 47.775-15.6l495.134-359.718 495.021 359.718c28.574 20.781 67.087 20.781 95.662.113 28.687-20.668 40.658-57.261 29.703-91.03l-189.176-582.1 495.36-359.83c28.574-20.894 40.433-57.487 29.364-91.03" fill-rule="evenodd"/>
	</svg>`;

    favBtn.onclick = (e) => {
      e.stopPropagation();
      renderFavoritesByCategory(cat);
    };
    div.appendChild(favBtn);

    list.appendChild(div);
  });
}

function renderChannelsByCategory(category, filter='') {
  list.innerHTML = '';
  list.scrollTop = 0;
  currentCategory = category;
  categoriesBtn.style.display = 'block';

  currentTitle.removeAttribute('data-category');
  currentCapital.textContent = 'TV Around';
  currentTime.textContent = 'The World';
  currentTitle.textContent = 'Internet Protocol TV';

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
    spanText.innerHTML = ch.displayName;

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

  currentTitle.removeAttribute('data-category');
  currentCapital.textContent = 'TV Around';
  currentTime.textContent = 'The World';
  currentTitle.textContent = 'Internet Protocol TV';

  const flagSet = new Set();
  channels.forEach(c => {
    if (!c.flag) return;
	if (c.flag === "🏴‍☠️") return;

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
  
  let validFlags = [countryFlag];
  const parentCountry = countries[countryFlag];
  currentTitle.textContent = parentCountry?.name || '';

  currentCapital.textContent = parentCountry?.capital || '';
  const tz = parentCountry?.timezone;
  currentTime.textContent = getTimeByTimezone(tz);

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
    spanText.innerHTML = ch.displayName;

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
  currentTitle.setAttribute('data-category', 'All Channels');
  currentCountry = 'all';
  backBtn.style.display = 'block';
  categoriesBtn.style.display = 'block';
  searchInput.placeholder = "Filter Channels";
  list.innerHTML = '';
  list.scrollTop = 0;

  const sorted = channels
    .filter(ch => ch.displayName.toLowerCase().includes(filter))
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
    spanText.innerHTML = ch.displayName;

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

function playChannel(index, element, channelObj) {
  const preview = document.getElementById('previewSite');
  if (preview) {
    preview.style.display = 'none';
  }

  currentChannel = channelObj ? channelObj : channels[index];
  if (!currentChannel || !currentChannel.url) return;

  document.querySelectorAll('.channel').forEach(el => el.classList.remove('active'));
  if (element) element.classList.add('active');
  currentChannelIndex = index;

  updateNowPlayingUI(currentChannel);
  updateVideoOverlay(currentChannel);
  updateFavoriteBtn(currentChannel);

  // Слушатель для отключения всех субтитров (один раз)
  if (!player.hasTrackListener) {
    player.textTracks.addEventListener("addtrack", e => e.track.mode = "disabled");
    player.hasTrackListener = true;
  }

  if (Hls.isSupported()) {
    if (!hls) hls = new Hls({ enableWebVTT: false });
    else hls.detachMedia();

    hls.loadSource(currentChannel.url);
    hls.attachMedia(player);

	if (Hls.isSupported()) {
	  if (!hls) hls = new Hls({ enableWebVTT: false });
	  else hls.detachMedia();

	  hls.loadSource(currentChannel.url);
	  hls.attachMedia(player);

	  // Сразу после attachMedia задаём сохранённую громкость
	  player.volume = savedVolume;

	  player.play().catch(() => {});
	}

    player.play().catch(() => {});

  } else if (player.canPlayType('application/vnd.apple.mpegurl')) {
	  player.src = currentChannel.url;

	  player.addEventListener('loadedmetadata', () => {
	    // громкость задаём уже после загрузки метаданных
	    player.volume = savedVolume;
	    player.play().catch(() => {});
	  });
    } else {
        alert("Ваш браузер не поддерживает HLS");
    }

  controls.classList.add("visible");
}

function updateFavoriteBtn(channelObj) {
  if (!channelObj) return;

  const isFav = favorites["All Channels"]?.has(channelObj.url); // проверка через Set.has

  favoriteIcon.setAttribute("fill", isFav ? "#fc0" : "#fff");
}

favoriteBtn.addEventListener("click", () => {
  if (!currentChannel) return;

  const channelId = currentChannel.url;
  const categories = currentChannel.groupTitle ? currentChannel.groupTitle.split(";").map(c => c.trim()) : [];

  const isFav = favorites["All Channels"]?.has(channelId);

  if (isFav) {
    favorites["All Channels"].delete(channelId);
    categories.forEach(cat => favorites[cat]?.delete(channelId));
  } else {
    if (!favorites["All Channels"]) favorites["All Channels"] = new Set();
    favorites["All Channels"].add(channelId);

    categories.forEach(cat => {
      if (!favorites[cat]) favorites[cat] = new Set();
      favorites[cat].add(channelId);
    });
  }

  saveFavorites();
  updateFavoriteBtn(currentChannel);

  // ---- Обновляем только иконку у текущего элемента, не перерисовываем список ----
  const el = document.querySelector(`.channel[data-index="${currentChannelIndex}"]`);
  if (el) {
    const favIcon = el.querySelector("#favoriteIcon");
    if (favIcon) favIcon.setAttribute("fill", favorites["All Channels"]?.has(channelId) ? "#fc0" : "#fff");
  }
});

function renderFavoritesByCategory(category) {
  categoriesBtn.style.display = 'block';
  currentCountry = 'categories'; // <-- чтобы логика фильтрации работала правильно
  currentCategory = category; // <-- важно, чтобы знало, какая категория активна
  list.innerHTML = '';
  list.scrollTop = 0;

  currentTitle.setAttribute('data-category', category + " ⭐");

  const favIds = favorites[category] ? [...favorites[category]] : [];
  const favChannels = channels.filter(ch => favIds.includes(ch.url));

  favChannels.forEach(ch => {
    const div = document.createElement('div');
    div.className = 'channel';
    div.dataset.type = 'channel';
    div.dataset.index = channels.indexOf(ch);

    const spanFlag = document.createElement('span');
    spanFlag.className = 'channel-flag';
    spanFlag.textContent = ch.flag;
	if (window.twemoji) {
      try {
        twemoji.parse(spanFlag, { folder: 'svg', ext: '.svg' });
      } catch (e) { console.warn("twemoji parse error", e); }
    }

    const spanText = document.createElement('span');
    spanText.className = 'channel-text';
    spanText.innerHTML = ch.displayName;

    div.appendChild(spanFlag);
    div.appendChild(spanText);

    div.onclick = () => playChannel(channels.indexOf(ch), div, ch);

    list.appendChild(div);
  });
}


function updateNowPlayingUI(channelObj) {
  // 🏴‍☠️ особый случай — каналы без страны
  if (channelObj.flag === "🏴‍☠️") {
    currentCapital.textContent = "No";
    currentTime.textContent = "Country";
    currentTitle.textContent = "Undefined";
    return;
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

function updateVideoOverlay(channelObj) {
  if (!channelObj) {
    document.getElementById('channelOverlay').style.display = 'none';
    return;
  }

  const flag = channelObj.flag;
  let parentCountry = countries[flag];
  let childCountry = parentCountry;

  for (const f in countries) {
    if (countries[f].dependencies && countries[f].dependencies[flag]) {
      parentCountry = countries[f];
      childCountry = countries[f].dependencies[flag];
      break;
    }
  }

  document.getElementById('channelOverlay').style.display = 'flex';

  const logoEl = document.getElementById('currentLogoVideo');

  logoEl.src = channelObj.logo && channelObj.logo.trim() !== ""
    ? channelObj.logo
    : "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='48'>❔</text></svg>";

  logoEl.onerror = () => {
    logoEl.src = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='48'>❔</text></svg>";
  };

  if (flag === "🏴‍☠️") {
    document.getElementById('currentNameVideo').innerHTML = channelObj.displayName;
    document.getElementById('currentFlagVideo').textContent = flag;
    document.getElementById('currentTitleVideo').textContent = "Undefined";
    document.getElementById('currentCapitalVideo').textContent = "No";
    document.getElementById('currentTimeVideo').textContent = "Country";
  } else {
    document.getElementById('currentNameVideo').innerHTML = channelObj.displayName;
    document.getElementById('currentFlagVideo').textContent = flag || '';
    document.getElementById('currentTitleVideo').textContent = parentCountry?.name || '';
    document.getElementById('currentCapitalVideo').textContent = childCountry?.capital || '';
    document.getElementById('currentTimeVideo').textContent = getTimeByTimezone(childCountry?.timezone || parentCountry?.timezone);
  }

  // прогоняем через twemoji, чтобы превратить буквенный код в графический флаг
  if (window.twemoji) {
    try {
      twemoji.parse(document.getElementById('currentFlagVideo'), { folder: 'svg', ext: '.svg' });
    } catch (e) { console.warn("twemoji parse error", e); }
  }
}


/* Кнопка возврата к списку стран */
backBtn.addEventListener('click', () => {
  categoriesBtn.style.display = 'block';
  searchInput.value = '';
  searchInput.focus();
  renderCountries('');
});

/* Обработчик кнопки Categories */
categoriesBtn.onclick = () => {
  currentCountry = 'categories';
  backBtn.style.display = 'block';
  categoriesBtn.style.display = 'none';
  searchInput.placeholder = "Filter Categories";
  searchInput.value = '';
  searchInput.focus();
  renderCategories();
};

/* Случайный выбор */
randomBtn.onclick = () => {
  const visible = Array.from(document.querySelectorAll('#channelList .channel'));
  if (visible.length === 0) return;

  let channelEls;

  if (currentCountry === 'categories' && currentCategory) {
    // Каналы только в текущей категории
    channelEls = visible.filter(el => el.dataset.type === 'channel');
    channelEls = channelEls.filter(el => {
      const ch = channels[parseInt(el.dataset.index, 10)];
      return ch && ch.groupTitle && ch.groupTitle.split(';').map(c => c.trim()).includes(currentCategory);
    });
  } else {
    // Каналы для стран или "All Channels"
    channelEls = visible.filter(el => el.dataset.type === 'channel');
  }

  if (channelEls.length > 0) {
    const pool = channelEls.filter(el => parseInt(el.dataset.index, 10) !== currentChannelIndex);
    if (pool.length === 0) return; // если один канал, ничего не делаем

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

  // Если видимых каналов нет — случайный выбор страны/категории
  if (currentCountry === 'categories') {
    const categoryEls = visible.filter(el => el.dataset.type === 'category');
    if (categoryEls.length === 0) return;
    const idxCategory = Math.floor(Math.random() * categoryEls.length);
    const categoryEl = categoryEls[idxCategory];
    categoryEl.click();

    searchInput.value = '';
    searchInput.focus();
  } else {
    // Старый функционал: случайная страна
    const countryEls = visible.filter(el => el.dataset.type === 'country');
    if (countryEls.length === 0) return;
    const idxCountry = Math.floor(Math.random() * countryEls.length);
    const countryEl = countryEls[idxCountry];
    countryEl.click();

    searchInput.value = '';
    searchInput.focus();
  }
};

// Play / Pause
playPauseBtn.onclick = () => {
  if (player.paused) {
    player.play();
  } else {
    player.pause();
  }
};

function createSite() {
  if (preview) return;
  preview = document.createElement('iframe');
  preview.id = 'previewSite';
  preview.src = 'https://radio.garden';
  preview.style.cssText = 'width:100%; height:100%; border:none; position:absolute;';
  playerContainer.appendChild(preview);
}

function removeSite() {
  if (preview) {
    playerContainer.removeChild(preview);
    preview = null;
  }
}

createSite();

// когда видео запускается
player.onplay = () => {
  playPauseBtn.textContent = '❚❚';
  removeSite();
};

// когда видео ставят на паузу
player.onpause = () => {
  playPauseBtn.textContent = '▶';
  createSite();
};

player.onended = () => createSite();

// Volume
function updateVolumeIcon() {
  const iconUrl = player.volume === 0 ? 'images/volume-off.svg' : 'images/volume-on.svg';
  volumeBtn.style.backgroundImage = `url('${iconUrl}')`;
}

function setVolume(v) {
  v = Math.max(0, Math.min(1, v));
  if (v > 0) savedVolume = v;
  player.volume = v;
  volumeSlider.value = v;
  updateVolumeIcon();
  localStorage.setItem('playerVolume', v);
}

volumeSlider.addEventListener('input', (e) => {
  setVolume(parseFloat(e.target.value));
});

volumeBtn.addEventListener('click', () => {
  if (player.volume === 0) {
    setVolume(savedVolume || 0.05);
  } else {
    setVolume(0); // mute
  }
});

// Fullscreen
function updateFullscreenIcon() {
  const iconUrl = document.fullscreenElement ? 'images/fullscreen-exit.svg' : 'images/fullscreen-enter.svg';
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

// Горячие клавиши
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey) {
    switch (e.code) {
      case "KeyP":
        e.preventDefault();
        if (player.paused) player.play();
        else player.pause();
        break;

	  case "KeyF":
        e.preventDefault();
        if (!document.fullscreenElement) {
          playerContainer.requestFullscreen().catch(err => console.log(err));
        } else {
          document.exitFullscreen();
        }
        updateFullscreenIcon();
        break;
		
	  case "ArrowLeft":
	    e.preventDefault();
		setVolume(player.volume - 0.05);
		break;

	  case "ArrowRight":
	    e.preventDefault();
		setVolume(player.volume + 0.05);
		break;
    }
  }
});
