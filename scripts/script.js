const playerContainer = document.getElementById('playerContainer');
const currentCapital = document.getElementById('currentCapital');
const categoriesEl = document.getElementById('categoriesBlock');
const categoriesBtn = document.getElementById('categoriesBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const playPauseBtn = document.getElementById('playPauseBtn');
const volumeSlider = document.getElementById('volumeSlider');
const favoriteIcon = document.getElementById("favoriteIcon");
const currentTitle = document.getElementById('currentTitle');
const favoriteBtn = document.getElementById("favoriteBtn");
const searchInput = document.getElementById('searchInput');
const showHideBtn = document.getElementById("showHideBtn");
const currentTime = document.getElementById('currentTime');
const overlay = document.getElementById('channelOverlay');
const volumeBtn = document.getElementById('volumeBtn');
const randomBtn = document.getElementById('randomBtn');
const controls = document.getElementById('controls');
const list = document.getElementById('channelList');
const homeBtn = document.getElementById('homeBtn');
const player = document.getElementById('player');

let currentCountry = undefined;
let savedVolume = 1;
let favorites = {};
let countries = {};
let channels = [];
let hls = null;
let preview = null;
let hideTimeout = null;
let currentChannel = null;
let currentTimezone = null;
let currentCategory = null;
let currentChannelIndex = null;
let showAllChannels = JSON.parse(localStorage.getItem('showAllChannels')) ?? true;

showHideBtn.style.backgroundImage = showAllChannels 
	? "url('images/show.svg')" 
	: "url('images/hide.svg')";

loadFavorites();

function cleanName(name) {
	return name
		.replace(/\[Geo-blocked\]/gi, '<img src="images/globe-lock.svg" alt="Geo-blocked" class="icon">')
		.replace(/\[Not 24\/7\]/gi, '<img src="images/time-lock.svg" alt="Not 24/7" class="icon">')
		.replace(/\s+/g, ' ')
		.trim();
}

function restoreActiveChannel() {
	if (!currentChannel) return;

	const activeEl = Array.from(list.children).find(
		el => el.dataset.type === 'channel' && channels[el.dataset.index]?.url === currentChannel.url
	);

	if (activeEl) {
		activeEl.classList.add('active');
	}
}

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

window.addEventListener('DOMContentLoaded', () => {
	const stored = localStorage.getItem('playerVolume');
	const v = stored !== null ? parseFloat(stored) : 1;
	setVolume(v);

	searchInput.value = '';

	fetch("https://raw.githubusercontent.com/nelabuzov/iptv/main/data/countries.json")
		.then(r => r.json())
		.then(data => {
			countries = data;

			setInterval(() => {
				if (currentTimezone) {
					currentTime.textContent = getTimeByTimezone(currentTimezone);
				}
			}, 1000);

			fetch("https://raw.githubusercontent.com/nelabuzov/iptv/main/data/channels.json")
				.then(r => r.json())
				.then(data => {
					channels = data.map(ch => {
						let flag = getFlagByTvgId(ch.tvgId);
						let groupTitle = ch.groupTitle;

						if (!ch.tvgId || !flag) {
							flag = "🏴‍☠️";
							groupTitle = "Undefined";
						}

						return {
							name: ch.name,
							displayName: stripQuality(cleanName(ch.name)),
							filterName: stripQuality(ch.name),
							url: ch.url,
							tvgId: ch.tvgId,
							logo: ch.tvgLogo,
							groupTitle,
							flag,
							working: ch.working
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
				if (!flag) {
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

	if ('all channels'.toLowerCase().includes(filter.toLowerCase())) {
		const allDiv = document.createElement('div');
		allDiv.className = 'channel';
		allDiv.dataset.type = 'all';
		allDiv.textContent = 'All Channels';

		allDiv.onclick = () => {
			currentCategory = "All Channels";
			isInFavoritesMode = false;
			searchInput.value = '';
			renderAllChannels();
		};

		const favBtn = document.createElement("button");

		favBtn.innerHTML = `
		<svg id="favoriteIcon" viewBox="0 0 1920 1920" xmlns="http://www.w3.org/2000/svg">
			<path d="M1915.918 737.475c-10.955-33.543-42.014-56.131-77.364-56.131h-612.029l-189.063-582.1v-.112C1026.394 65.588 995.335 43 959.984 43c-35.237 0-66.41 22.588-77.365 56.245L693.443 681.344H81.415c-35.35 0-66.41 22.588-77.365 56.131-10.955 33.544.79 70.137 29.478 91.03l495.247 359.831-189.177 582.212c-10.955 33.657 1.13 70.25 29.817 90.918 14.23 10.278 30.946 15.487 47.66 15.487 16.716 0 33.432-5.21 47.775-15.6l495.134-359.718 495.021 359.718c28.574 20.781 67.087 20.781 95.662.113 28.687-20.668 40.658-57.261 29.703-91.03l-189.176-582.1 495.36-359.83c28.574-20.894 40.433-57.487 29.364-91.03" fill-rule="evenodd"/>
		</svg>`;

		favBtn.onclick = (e) => {
			e.stopPropagation();
			currentCategory = "All Channels";
			isInFavoritesMode = true;
			searchInput.value = '';
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
			if (!trimmed) return;
			const hasChannel = channels.some(ch2 =>
				(showAllChannels || ch2.working) &&
				ch2.groupTitle &&
				ch2.groupTitle.split(';').map(c => c.trim()).includes(trimmed)
			);
			if (hasChannel && trimmed.toLowerCase().includes(filter.toLowerCase())) {
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

		const catChannels = channels.filter(ch =>
			ch.groupTitle &&
			ch.groupTitle.split(';').map(c => c.trim()).includes(cat)
		);
		const allBroken = catChannels.length > 0 && catChannels.every(ch => !ch.working);

		if (allBroken) {
			div.classList.add('disabled-category');
		}

		div.onclick = () => {
			currentCategory = cat;
			isInFavoritesMode = false;
			searchInput.value = '';
			renderChannelsByCategory(cat);
		};

		const favBtn = document.createElement("button");
		favBtn.innerHTML = `
		<svg id="favoriteIcon" viewBox="0 0 1920 1920" xmlns="http://www.w3.org/2000/svg" fill="#fc0">
			<path d="M1915.918 737.475c-10.955-33.543-42.014-56.131-77.364-56.131h-612.029l-189.063-582.1v-.112C1026.394 65.588 995.335 43 959.984 43c-35.237 0-66.41 22.588-77.365 56.245L693.443 681.344H81.415c-35.35 0-66.41 22.588-77.365 56.131-10.955 33.544.79 70.137 29.478 91.03l495.247 359.831-189.177 582.212c-10.955 33.657 1.13 70.25 29.817 90.918 14.23 10.278 30.946 15.487 47.66 15.487 16.716 0 33.432-5.21 47.775-15.6l495.134-359.718 495.021 359.718c28.574 20.781 67.087 20.781 95.662.113 28.687-20.668 40.658-57.261 29.703-91.03l-189.176-582.1 495.36-359.83c28.574-20.894 40.433-57.487 29.364-91.03" fill-rule="evenodd"/>
		</svg>`;

		favBtn.onclick = (e) => {
			e.stopPropagation();
			currentCategory = cat;
			isInFavoritesMode = true;
			searchInput.value = '';
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

	document.getElementById("currentTitle").classList.remove("favorite");

	currentTitle.setAttribute('data-category', category);

	currentCapital.textContent = 'TV Around';
	currentTime.textContent = 'The World';
	currentTitle.textContent = 'Internet Protocol TV';

	const filtered = channels.filter(ch =>
		(showAllChannels || ch.working) &&
		ch.groupTitle &&
		ch.groupTitle.split(';').map(c => c.trim()).includes(category) &&
		ch.filterName.toLowerCase().includes(filter)
	);

	filtered.forEach(ch => {
		const div = document.createElement('div');
		div.className = 'channel';
		if (!ch.working) div.classList.add('disabled-channel');

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
		try {
			twemoji.parse(list, { folder: 'svg', ext: '.svg' });
		} catch (e) { console.warn("twemoji parse error", e); }
	}

	restoreActiveChannel();
}

function renderCountries(filter = '') {
	currentCountry = undefined;
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

	flags.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

	flags = flags.filter(fObj => {
		const countryChannels = channels.filter(ch => ch.flag === fObj.flag);

		const hasWorking = countryChannels.some(ch => ch.working);

		const shouldShow = showAllChannels ? countryChannels.length > 0 : hasWorking;

		return shouldShow && fObj.name.toLowerCase().includes(filter.toLowerCase());
	});

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

		let validFlags = [fObj.flag];
		if (countries[fObj.flag]?.dependencies) {
			validFlags = validFlags.concat(Object.keys(countries[fObj.flag].dependencies));
		}

		const countryChannels = channels.filter(ch => validFlags.includes(ch.flag));

		const allDisabled = countryChannels.every(ch => !ch.working);
		if (allDisabled) {
			div.classList.add('disabled-country');
		}

		div.onclick = () => {
			isInFavoritesMode = false;
			searchInput.value = '';
			renderChannels(fObj.flag);
		};

		list.appendChild(div);
	});

	if (window.twemoji) {
		try { twemoji.parse(list, { folder: 'svg', ext: '.svg' }); }
		catch (e) { console.warn("twemoji parse error", e); }
	}
}

function renderChannels(countryFlag, filter = '') {
	currentCountry = countryFlag;
	searchInput.placeholder = "Filter Channels";
	list.innerHTML = '';
	list.scrollTop = 0;

	let validFlags = [countryFlag];
	const parentCountry = countries[countryFlag];
	currentTitle.textContent = parentCountry?.name || '';

	currentCapital.textContent = parentCountry?.capital || '';
	const tz = parentCountry?.timezone;
	currentTime.textContent = getTimeByTimezone(tz);

	if (countries[countryFlag]?.dependencies) {
		validFlags = validFlags.concat(Object.keys(countries[countryFlag].dependencies));
	}

	const filtered = channels.filter(ch => {
		if (!showAllChannels && !ch.working) return false;
		if (!ch.flag) return false;
		if (!validFlags.includes(ch.flag)) return false;
		return ch.filterName.toLowerCase().includes(filter.toLowerCase());
	});

	filtered.forEach((ch, idx) => {
		const div = document.createElement('div');
		div.className = 'channel';
		if (!ch.working) div.classList.add('disabled-channel');

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

	restoreActiveChannel();
}

function renderAllChannels(filter = '') {
	currentTitle.setAttribute('data-category', 'All Channels');
	currentCountry = 'all';
	searchInput.placeholder = "Filter Channels";
	list.innerHTML = '';
	list.scrollTop = 0;

	document.getElementById("currentTitle").classList.remove("favorite");

	const sorted = channels
		.filter(ch => (showAllChannels || ch.working) && ch.filterName.toLowerCase().includes(filter.toLowerCase()))
		.sort((a, b) => a.displayName.localeCompare(b.displayName, 'en', {sensitivity: 'base'}));

	sorted.forEach(ch => {
		const div = document.createElement('div');
		div.className = 'channel';
		if (!ch.working) div.classList.add('disabled-channel');

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

	restoreActiveChannel();
}

function renderFavoritesByCategory(category, filter = '') {
	currentCountry = 'categories'; 
	currentCategory = category; 
	list.innerHTML = '';
	list.scrollTop = 0;

	document.getElementById("currentTitle").classList.add("favorite");

	currentTitle.setAttribute('data-category', currentCategory);

	const favIds = favorites[category] ? [...favorites[category]] : [];

	const favChannels = channels.filter(ch =>
		favIds.includes(ch.url) &&
		ch.filterName.toLowerCase().includes(filter.toLowerCase()) &&
		(showAllChannels || ch.working)
	);

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

		if (!ch.working) {
			div.classList.add('disabled-channel');
		}

		div.onclick = () => playChannel(channels.indexOf(ch), div, ch);

		list.appendChild(div);
	});

	restoreActiveChannel();
}

function updateFavoriteBtn(channelObj) {
	if (!channelObj) return;

	const isFav = favorites["All Channels"]?.has(channelObj.url);

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

	const el = document.querySelector(`.channel[data-index="${currentChannelIndex}"]`);
	if (el) {
		const favIcon = el.querySelector("#favoriteIcon");
		if (favIcon) favIcon.setAttribute("fill", favorites["All Channels"]?.has(channelId) ? "#fc0" : "#fff");
	}

	if (currentCountry === 'categories' && currentCategory && isInFavoritesMode) {
		renderFavoritesByCategory(currentCategory, searchInput.value);
	}
});

function updateNowPlayingUI(channelObj) {
	if (channelObj.flag === "🏴‍☠️") {
		currentCapital.textContent = "No";
		currentTime.textContent = "Country";
		currentTitle.textContent = "Hidden";
		return;
	}

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
			if (isInFavoritesMode) {
				renderFavoritesByCategory(currentCategory, filter);
			} else {
				renderChannelsByCategory(currentCategory, filter);
			}
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
		: "images/question.svg";

	logoEl.onerror = () => {
		logoEl.src = "images/question.svg";
	};

	if (flag === "🏴‍☠️") {
		document.getElementById('currentNameVideo').innerHTML = channelObj.displayName;
		document.getElementById('currentFlagVideo').textContent = flag;
		document.getElementById('currentTitleVideo').textContent = "Hidden";
		document.getElementById('currentCapitalVideo').textContent = "No";
		document.getElementById('currentTimeVideo').textContent = "Country";
	} else {
		document.getElementById('currentNameVideo').innerHTML = channelObj.displayName;
		document.getElementById('currentFlagVideo').textContent = flag || '';
		document.getElementById('currentTitleVideo').textContent = parentCountry?.name || '';
		document.getElementById('currentCapitalVideo').textContent = childCountry?.capital || '';
		document.getElementById('currentTimeVideo').textContent = getTimeByTimezone(childCountry?.timezone || parentCountry?.timezone);
	}

	const categories = channelObj.groupTitle
		? channelObj.groupTitle.split(';').map(c => c.trim()).filter(Boolean)
		: [];
	categoriesEl.textContent = categories.join(' & ');

	if (window.twemoji) {
		try {
			twemoji.parse(document.getElementById('currentFlagVideo'), { folder: 'svg', ext: '.svg' });
		} catch (e) { console.warn("twemoji parse error", e); }
	}
}

function playChannel(index, element, channelObj) {
	const preview = document.getElementById('previewMedia');
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

	player.style.background = 'url("images/loading.gif") no-repeat center / 250px 250px';

	if (!player.hasTrackListener) {
		player.textTracks.addEventListener("addtrack", e => e.track.mode = "disabled");
		player.hasTrackListener = true;
	}

	if (Hls.isSupported()) {
		if (!hls) {
			hls = new Hls({ enableWebVTT: false });
		} else {
			hls.detachMedia();
		}

		hls.loadSource(currentChannel.url);
		hls.attachMedia(player);

		player.volume = savedVolume;
		player.play().catch(() => {});

		hls.on(Hls.Events.ERROR, (event, data) => {
			console.error("HLS error:", data);
			if (data.fatal) {
				showErrorBackground(player);
				hls.destroy();
				hls = null;
			}
		});

	} else if (player.canPlayType('application/vnd.apple.mpegurl')) {
		player.src = currentChannel.url;
		player.addEventListener('loadedmetadata', () => {
			player.volume = savedVolume;
			player.play().catch(() => {});
		});
	} else {
		alert("Ваш браузер не поддерживает HLS");
	}

	player.onerror = () => {
		console.warn("Video error");
		showErrorBackground(player);
	};

	player.addEventListener('playing', () => {
		player.style.background = 'black';
	}, { once: true });

	controls.classList.add("visible");
}

function showErrorBackground(player) {
	player.pause();
	player.removeAttribute("src");
	player.load();
	player.style.background = 'url("images/error.gif") no-repeat center / 500px 500px';
}

homeBtn.addEventListener('click', () => {
	searchInput.value = '';
	renderCountries('');
});

categoriesBtn.onclick = () => {
	currentCountry = 'categories';
	searchInput.placeholder = "Filter Categories";
	searchInput.value = '';
	renderCategories();
};

randomBtn.onclick = () => {
	let visibleEls = Array.from(document.querySelectorAll('#channelList .channel'))
		.filter(el => el.offsetParent !== null);

	if (currentCountry === 'categories') {
		visibleEls = visibleEls.filter(el => el.dataset.type !== 'all' && el.textContent.trim() !== 'All Channels');
	}

	if (visibleEls.length === 0) return;

	let pool = visibleEls;
	if (currentChannelIndex !== null) {
		pool = visibleEls.filter(el => el.dataset.type !== 'channel' || parseInt(el.dataset.index, 10) !== currentChannelIndex);
	}
	if (pool.length === 0) return;

	const idx = Math.floor(Math.random() * pool.length);
	const el = pool[idx];

	switch (el.dataset.type) {
		case 'channel': {
			const chIndex = parseInt(el.dataset.index, 10);
			const ch = channels[chIndex];
			if (ch) {
				el.scrollIntoView({ behavior: 'auto', block: 'start' });
				playChannel(chIndex, el, ch);
			}
			break;
		}
		case 'category': {
			currentCategory = el.textContent.trim();
			isInFavoritesMode = false;
			searchInput.value = '';
			renderChannelsByCategory(currentCategory);
			break;
		}
		case 'country': {
			const flag = el.dataset.flag;
			isInFavoritesMode = false;
			searchInput.value = '';
			renderChannels(flag);
			break;
		}
	}

	searchInput.value = '';
};

playPauseBtn.onclick = () => {
	if (player.paused) {
		player.play();
	} else {
		player.pause();
	}
};

showHideBtn.addEventListener("click", () => {
	showAllChannels = !showAllChannels;
	localStorage.setItem('showAllChannels', JSON.stringify(showAllChannels));

	if (currentCountry === undefined) {
		renderCountries(searchInput.value.trim().toLowerCase());
	} else if (currentCountry === 'all') {
		renderAllChannels(searchInput.value.trim().toLowerCase());
	} else if (currentCountry === 'categories') {
		if (currentCategory) {
			if (isInFavoritesMode) {
				renderFavoritesByCategory(currentCategory, searchInput.value.trim().toLowerCase());
			} else {
				renderChannelsByCategory(currentCategory, searchInput.value.trim().toLowerCase());
			}
		} else {
			renderCategories(searchInput.value.trim().toLowerCase());
		}
	} else {
		renderChannels(currentCountry, searchInput.value.trim().toLowerCase());
	}

	showHideBtn.style.backgroundImage = showAllChannels 
		? "url('images/show.svg')" 
		: "url('images/hide.svg')";
});

function createMedia() {
	if (preview) return;
	preview = document.createElement('img');
	preview.id = 'previewMedia';
	preview.src = 'images/wallpaper.jpg';
	preview.style.cssText = 'width:100%; height:100%; border:none; position:absolute;';
	playerContainer.appendChild(preview);
}

function removeMedia() {
	if (preview) {
		playerContainer.removeChild(preview);
		preview = null;
	}
}

createMedia();

player.onplay = () => {
	playPauseBtn.style.backgroundImage = "url('images/pause.svg')";
};

player.onpause = () => {
	playPauseBtn.style.backgroundImage = "url('images/play.svg')";
};

player.onended = () => createMedia();

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
		setVolume(0);
	}
});

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
	updateFullscreenIcon();
};

document.addEventListener('fullscreenchange', updateFullscreenIcon);

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

document.getElementById("crossVideo").addEventListener("click", () => {
	closeVideo();
});

function closeVideo() {
	const player = document.getElementById("player");
	const active = document.querySelector(".channel.active");

	if (player) {
		player.pause();
		player.load();
		player.removeAttribute("src");
	}
  
	if (active) {
		active.classList.remove("active");
	}

	const overlay = document.getElementById("previewMedia");
	overlay.style.display = "block";
}

const HIDE_DELAY = 2500;
let overlayTimerId = null;

function showOverlay() {
	overlay.style.opacity = '1';
	overlay.style.pointerEvents = 'auto';
}

function hideOverlay() {
	overlay.style.opacity = '0';
	overlay.style.pointerEvents = 'none';
}

function armHide() {
	clearTimeout(overlayTimerId);
	overlayTimerId = setTimeout(hideOverlay, HIDE_DELAY);
}

function isInOverlayArea(e) {
	const r = overlay.getBoundingClientRect();
	return e.clientX >= r.left && e.clientX <= r.right &&
		e.clientY >= r.top  && e.clientY <= r.bottom;
}

function onOverlayAreaMove(e) {
	if (!isInOverlayArea(e)) return;
	showOverlay();
	armHide();
}

hideOverlay();

playerContainer.addEventListener('mousemove', onOverlayAreaMove, { passive: true });
overlay.addEventListener('mousemove', onOverlayAreaMove, { passive: true });
