const STORAGE_KEY = 'exam-clock-settings';
const BELL_STORAGE_KEY = 'school-bell-schedule';
const POMODORO_STORAGE_KEY = 'study-pomodoro-settings';
const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

let settings;
let bellSettings;
let pomodoroSettings;
let pomodoro;
let audioContext;
let clockCanvas;
let clockStage;
let dateLine;
let countdownLine;
let fullscreenButton;
let autoBellStatus;
let scheduleList;
let pomodoroPhaseLabel;
let pomodoroTimeLabel;
let pomodoroRoundLabel;
let pomodoroStartButton;
let pomodoroPauseButton;
let pomodoroFocusInput;
let pomodoroBreakInput;
let fields = {};
let infoValues = {};
let tabButtons = {};
let activeTab = 'exam';
let playedBellKeys = new Set();
let displayedPomodoroSecond = -1;

function setup() {
  noLoop();
  settings = loadSettings();
  bellSettings = loadBellSettings();
  pomodoroSettings = loadPomodoroSettings();
  pomodoro = {
    phase: 'focus',
    round: 1,
    remainingSeconds: pomodoroSettings.focusMinutes * 60,
    running: false,
    deadline: 0,
  };
  document.title = '考試大鐘';
  document.documentElement.lang = 'zh-Hant';
  addStyles();
  buildInterface();
  resizeClock();
  updateDisplay();
  updatePomodoroDisplay();
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  loop();
}

function draw() {
  background('#111619');
  const now = new Date();
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');

  textAlign(CENTER, CENTER);
  textFont('monospace');
  textStyle(NORMAL);
  fill('#f1f5f3');
  textSize(min(width * 0.19, 184));
  text(time, width / 2, height / 2);

  dateLine.elt.textContent = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日　${WEEKDAYS[now.getDay()]}`;
  updateCountdown(now);
  checkAutomaticBell(now);
  tickPomodoro(Date.now());
}

function buildInterface() {
  const shell = createDiv().addClass('app-shell');
  const header = createElement('header').addClass('topbar').parent(shell);
  createDiv('課堂計時工具').addClass('brand').parent(header);
  fullscreenButton = createButton('⛶　全螢幕').addClass('fullscreen-button').parent(header);
  fullscreenButton.attribute('type', 'button');
  fullscreenButton.attribute('aria-label', '切換全螢幕');
  fullscreenButton.mousePressed(toggleFullscreen);

  const tabNav = createElement('nav').addClass('tab-nav').attribute('aria-label', '功能分頁').parent(shell);
  [['exam', '考試大鐘'], ['bells', '上下課鐘'], ['pomodoro', '讀書番茄鐘']].forEach(([key, label]) => {
    const button = createButton(label).addClass(`tab-button${key === activeTab ? ' active' : ''}`).parent(tabNav);
    button.attribute('type', 'button');
    button.attribute('aria-current', key === activeTab ? 'page' : 'false');
    button.mousePressed(() => setActiveTab(key));
    tabButtons[key] = button;
  });

  const main = createElement('main').addClass('main-content').parent(shell);
  const examPanel = createElement('section').addClass('page-panel active').attribute('aria-label', '考試大鐘').parent(main);
  dateLine = createDiv().addClass('date-line').parent(examPanel);
  clockStage = createDiv().addClass('clock-stage').parent(examPanel);
  clockCanvas = createCanvas(800, 280);
  clockCanvas.parent(clockStage);
  clockCanvas.addClass('clock-canvas');

  countdownLine = createDiv().addClass('countdown-line').parent(examPanel);
  const infoSection = createElement('section').addClass('exam-info').attribute('aria-label', '考試資訊').parent(examPanel);
  const infoItems = [
    ['subject', '考試科目'],
    ['examTime', '考試時間'],
    ['teacher', '監考老師'],
    ['required', '應到人數'],
    ['attended', '實到人數'],
    ['absent', '缺考人數'],
  ];

  infoItems.forEach(([key, label]) => {
    const item = createDiv().addClass(`info-item info-${key}`).parent(infoSection);
    createDiv(label).addClass('info-label').parent(item);
    infoValues[key] = createDiv('—').addClass('info-value').parent(item);
  });

  const controls = createElement('section').addClass('controls').attribute('aria-label', '考試設定').parent(examPanel);
  createDiv('考試設定').addClass('controls-title').parent(controls);
  const formGrid = createDiv().addClass('form-grid').parent(controls);

  fields.subject = addField(formGrid, '科目', 'text', '例如：數位學習概論', 'subject');
  fields.startTime = addField(formGrid, '開始時間', 'time', '', 'startTime');
  fields.endTime = addField(formGrid, '結束時間', 'time', '', 'endTime');
  fields.teacher = addField(formGrid, '監考老師', 'text', '輸入老師姓名', 'teacher');
  fields.required = addField(formGrid, '應到人數', 'number', '', 'required');
  fields.attended = addField(formGrid, '實到人數', 'number', '', 'attended');

  Object.entries(fields).forEach(([key, field]) => {
    field.value(settings[key] ?? '');
    field.input(() => {
      settings[key] = field.value();
      if (key === 'required' || key === 'attended') {
        settings[key] = Math.max(0, Number(settings[key]) || 0);
      }
      saveSettings();
      updateDisplay();
    });
  });

  const footer = createDiv('資料會自動保存在此裝置').addClass('footer-note').parent(examPanel);
  footer.attribute('aria-live', 'polite');

  buildBellPanel(main);
  buildPomodoroPanel(main);
  document.addEventListener('fullscreenchange', updateFullscreenState);
}

function buildBellPanel(parent) {
  const panel = createElement('section').addClass('page-panel').attribute('aria-label', '上下課鐘').parent(parent);
  createElement('h1', '上下課鐘').addClass('page-title').parent(panel);

  const actions = createDiv().addClass('bell-actions').parent(panel);
  makeButton(actions, '上課鈴', 'bell-play-button class-bell', () => playBell('class'));
  makeButton(actions, '下課鈴', 'bell-play-button break-bell', () => playBell('break'));

  const scheduleSection = createElement('section').addClass('schedule-section').attribute('aria-label', '課表設定').parent(panel);
  const scheduleHeading = createDiv().addClass('schedule-heading').parent(scheduleSection);
  createDiv('每日課表').addClass('section-title').parent(scheduleHeading);

  const scheduleActions = createDiv().addClass('schedule-actions').parent(scheduleHeading);
  const autoToggle = createCheckbox('啟用自動打鐘', bellSettings.enabled).addClass('auto-toggle').parent(scheduleActions);
  autoToggle.changed(() => {
    bellSettings.enabled = autoToggle.checked();
    saveBellSettings();
    updateAutoBellStatus();
    if (bellSettings.enabled) ensureAudioContext();
  });
  const addPeriodButton = createButton('＋　新增一節').addClass('secondary-button').parent(scheduleActions);
  addPeriodButton.attribute('type', 'button');
  addPeriodButton.mousePressed(() => {
    bellSettings.periods.push({ start: '', end: '' });
    saveBellSettings();
    renderSchedule();
  });

  autoBellStatus = createDiv().addClass('status-line').parent(scheduleSection);
  scheduleList = createDiv().addClass('schedule-list').parent(scheduleSection);
  renderSchedule();
  updateAutoBellStatus();
}

function buildPomodoroPanel(parent) {
  const panel = createElement('section').addClass('page-panel pomodoro-panel').attribute('aria-label', '讀書番茄鐘').parent(parent);
  createElement('h1', '讀書番茄鐘').addClass('page-title').parent(panel);

  const timer = createDiv().addClass('pomodoro-timer').parent(panel);
  pomodoroPhaseLabel = createDiv().addClass('pomodoro-phase').parent(timer);
  pomodoroTimeLabel = createDiv().addClass('pomodoro-time').parent(timer);
  pomodoroRoundLabel = createDiv().addClass('pomodoro-round').parent(timer);

  const timerActions = createDiv().addClass('pomodoro-actions').parent(panel);
  pomodoroStartButton = makeButton(timerActions, '開始', 'timer-button primary-action', startPomodoro);
  pomodoroPauseButton = makeButton(timerActions, '暫停', 'timer-button', pausePomodoro);
  makeButton(timerActions, '重設', 'timer-button', resetPomodoro);
  makeButton(timerActions, '跳過', 'timer-button', skipPomodoro);

  const durationSettings = createDiv().addClass('duration-settings').parent(panel);
  pomodoroFocusInput = addField(durationSettings, '專注（分鐘）', 'number', '', 'pomodoro-focus');
  pomodoroBreakInput = addField(durationSettings, '休息（分鐘）', 'number', '', 'pomodoro-break');
  pomodoroFocusInput.attribute('min', '1');
  pomodoroFocusInput.attribute('max', '180');
  pomodoroBreakInput.attribute('min', '1');
  pomodoroBreakInput.attribute('max', '180');
  pomodoroFocusInput.value(pomodoroSettings.focusMinutes);
  pomodoroBreakInput.value(pomodoroSettings.breakMinutes);
  pomodoroFocusInput.input(() => updatePomodoroDuration('focusMinutes', pomodoroFocusInput));
  pomodoroBreakInput.input(() => updatePomodoroDuration('breakMinutes', pomodoroBreakInput));
}

function makeButton(parent, label, className, callback) {
  const button = createButton(label).addClass(className).parent(parent);
  button.attribute('type', 'button');
  button.mousePressed(callback);
  return button;
}

function setActiveTab(tab) {
  activeTab = tab;
  const panels = document.querySelectorAll('.page-panel');
  panels.forEach((panel) => panel.classList.toggle('active', panel.getAttribute('aria-label') === tabLabel(tab)));
  Object.entries(tabButtons).forEach(([key, button]) => {
    button.elt.classList.toggle('active', key === tab);
    button.attribute('aria-current', key === tab ? 'page' : 'false');
  });
  resizeClock();
}

function tabLabel(tab) {
  return { exam: '考試大鐘', bells: '上下課鐘', pomodoro: '讀書番茄鐘' }[tab];
}

function addField(parent, label, type, placeholder, name) {
  const wrapper = createDiv().addClass('field').parent(parent);
  const inputId = `exam-${name}`;
  createElement('label', label).attribute('for', inputId).parent(wrapper);
  const input = createInput('', type).parent(wrapper);
  input.attribute('id', inputId);
  input.attribute('name', name);
  input.attribute('autocomplete', 'off');
  if (placeholder) input.attribute('placeholder', placeholder);
  if (type === 'number') {
    input.attribute('min', '0');
    input.attribute('step', '1');
    input.attribute('inputmode', 'numeric');
  }
  return input;
}

function updateDisplay() {
  infoValues.subject.elt.textContent = settings.subject || '尚未設定';
  infoValues.examTime.elt.textContent = settings.startTime && settings.endTime
    ? `${settings.startTime} ～ ${settings.endTime}`
    : '尚未設定';
  infoValues.teacher.elt.textContent = settings.teacher || '尚未設定';

  const required = Math.max(0, Number(settings.required) || 0);
  const attended = Math.max(0, Number(settings.attended) || 0);
  infoValues.required.elt.textContent = `${required} 人`;
  infoValues.attended.elt.textContent = `${attended} 人`;
  infoValues.absent.elt.textContent = `${Math.max(0, required - attended)} 人`;
}

function updateCountdown(now) {
  countdownLine.removeClass('urgent');
  countdownLine.removeClass('finished');

  if (!settings.endTime) {
    countdownLine.elt.textContent = '請設定考試結束時間';
    return;
  }

  const [endHour, endMinute] = settings.endTime.split(':').map(Number);
  const end = new Date(now);
  end.setHours(endHour, endMinute, 0, 0);

  if (settings.startTime) {
    const [startHour, startMinute] = settings.startTime.split(':').map(Number);
    if (endHour * 60 + endMinute < startHour * 60 + startMinute) {
      end.setDate(end.getDate() + 1);
    }
  }

  const remainingMs = end.getTime() - now.getTime();
  if (remainingMs <= 0) {
    countdownLine.elt.textContent = '考試時間已結束';
    countdownLine.addClass('finished');
    return;
  }

  const minutes = Math.ceil(remainingMs / 60000);
  countdownLine.elt.textContent = `距離考試結束還有 ${minutes} 分鐘`;
  if (minutes <= 10) countdownLine.addClass('urgent');
}

function renderSchedule() {
  scheduleList.html('');
  const headings = createDiv().addClass('schedule-row schedule-headings').parent(scheduleList);
  ['節次', '上課時間', '下課時間', ''].forEach((label) => createDiv(label).parent(headings));
  if (bellSettings.periods.length === 0) {
    createDiv('尚未新增課節').addClass('empty-schedule').parent(scheduleList);
    return;
  }

  bellSettings.periods.forEach((period, index) => {
    const row = createDiv().addClass('schedule-row').parent(scheduleList);
    createDiv(`第 ${index + 1} 節`).addClass('period-name').parent(row);
    const start = createInput('', 'time').addClass('schedule-time').parent(row);
    start.attribute('aria-label', `第 ${index + 1} 節上課時間`);
    start.value(period.start || '');
    start.input(() => {
      bellSettings.periods[index].start = start.value();
      saveBellSettings();
    });

    const end = createInput('', 'time').addClass('schedule-time').parent(row);
    end.attribute('aria-label', `第 ${index + 1} 節下課時間`);
    end.value(period.end || '');
    end.input(() => {
      bellSettings.periods[index].end = end.value();
      saveBellSettings();
    });

    const remove = createButton('刪除').addClass('delete-button').parent(row);
    remove.attribute('type', 'button');
    remove.attribute('aria-label', `刪除第 ${index + 1} 節`);
    remove.mousePressed(() => {
      bellSettings.periods.splice(index, 1);
      saveBellSettings();
      renderSchedule();
    });
  });
}

function updateAutoBellStatus() {
  autoBellStatus.elt.textContent = bellSettings.enabled ? '自動打鐘已啟用' : '自動打鐘已停用';
  autoBellStatus.elt.classList.toggle('status-enabled', bellSettings.enabled);
}

function checkAutomaticBell(now) {
  if (!bellSettings.enabled || now.getSeconds() !== 0) return;

  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const dateKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  bellSettings.periods.forEach((period, index) => {
    const bellType = period.start === time ? 'class' : period.end === time ? 'break' : null;
    if (!bellType) return;

    const key = `${dateKey}-${index}-${bellType}-${time}`;
    if (playedBellKeys.has(key)) return;
    playedBellKeys.add(key);
    playBell(bellType);
  });
}

function unlockAudio() {
  ensureAudioContext();
}

function ensureAudioContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioContext) audioContext = new AudioContextClass();
  if (audioContext.state === 'suspended') audioContext.resume();
  return audioContext;
}

function playBell(type) {
  const context = ensureAudioContext();
  if (!context) return;

  let notes;
  if (type === 'class') {
    notes = [
      { frequency: 659.25, offset: 0 },
      { frequency: 783.99, offset: 0.38 },
      { frequency: 987.77, offset: 0.76 },
      { frequency: 783.99, offset: 1.14 },
    ];
  } else if (type === 'break') {
    notes = [
      { frequency: 987.77, offset: 0 },
      { frequency: 783.99, offset: 0.42 },
      { frequency: 659.25, offset: 0.84 },
      { frequency: 523.25, offset: 1.26 },
    ];
  } else {
    notes = type === 'focus-end'
      ? [{ frequency: 880, offset: 0 }, { frequency: 1046.5, offset: 0.32 }, { frequency: 1318.5, offset: 0.64 }]
      : [{ frequency: 659.25, offset: 0 }, { frequency: 880, offset: 0.4 }];
  }

  const startAt = context.currentTime + 0.04;
  notes.forEach(({ frequency, offset }) => {
    playBellStrike(context, frequency, startAt + offset, type === 'class' || type === 'break' ? 0.48 : 0.34);
  });
}

function playBellStrike(context, frequency, startAt, duration) {
  [1, 2.01, 2.97].forEach((partial, index) => {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const volume = (index === 0 ? 0.16 : 0.07 / index);
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency * partial, startAt);
    envelope.gain.setValueAtTime(0.0001, startAt);
    envelope.gain.exponentialRampToValueAtTime(volume, startAt + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(envelope);
    envelope.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.02);
  });
}

function getPomodoroDuration(phase = pomodoro.phase) {
  return (phase === 'focus' ? pomodoroSettings.focusMinutes : pomodoroSettings.breakMinutes) * 60;
}

function updatePomodoroDuration(key, input) {
  const parsed = Math.floor(Number(input.value()));
  const minutes = Math.min(180, Math.max(1, parsed || (key === 'focusMinutes' ? 25 : 5)));
  pomodoroSettings[key] = minutes;
  input.value(minutes);
  savePomodoroSettings();

  const currentKey = pomodoro.phase === 'focus' ? 'focusMinutes' : 'breakMinutes';
  if (key === currentKey) {
    pomodoro.remainingSeconds = minutes * 60;
    if (pomodoro.running) pomodoro.deadline = Date.now() + pomodoro.remainingSeconds * 1000;
    updatePomodoroDisplay();
  }
}

function startPomodoro() {
  if (pomodoro.running) return;
  ensureAudioContext();
  pomodoro.running = true;
  pomodoro.deadline = Date.now() + pomodoro.remainingSeconds * 1000;
  updatePomodoroButtons();
}

function pausePomodoro() {
  if (!pomodoro.running) return;
  pomodoro.remainingSeconds = Math.max(0, Math.ceil((pomodoro.deadline - Date.now()) / 1000));
  pomodoro.running = false;
  updatePomodoroDisplay();
  updatePomodoroButtons();
}

function resetPomodoro() {
  pomodoro.running = false;
  pomodoro.remainingSeconds = getPomodoroDuration();
  updatePomodoroDisplay();
  updatePomodoroButtons();
}

function skipPomodoro() {
  switchPomodoroPhase(true, false);
}

function tickPomodoro(now) {
  if (!pomodoro.running) return;
  const remaining = Math.ceil((pomodoro.deadline - now) / 1000);
  if (remaining <= 0) {
    switchPomodoroPhase(true, true);
    return;
  }

  if (remaining !== pomodoro.remainingSeconds) {
    pomodoro.remainingSeconds = remaining;
    if (remaining !== displayedPomodoroSecond) updatePomodoroDisplay();
  }
}

function switchPomodoroPhase(startNext, playSound) {
  if (playSound) playBell(pomodoro.phase === 'focus' ? 'focus-end' : 'break-end');
  if (pomodoro.phase === 'focus') {
    pomodoro.phase = 'break';
  } else {
    pomodoro.phase = 'focus';
    pomodoro.round += 1;
  }
  pomodoro.remainingSeconds = getPomodoroDuration();
  pomodoro.running = startNext;
  if (startNext) pomodoro.deadline = Date.now() + pomodoro.remainingSeconds * 1000;
  updatePomodoroDisplay();
  updatePomodoroButtons();
}

function updatePomodoroDisplay() {
  if (!pomodoroTimeLabel) return;
  const minutes = Math.floor(pomodoro.remainingSeconds / 60);
  const seconds = pomodoro.remainingSeconds % 60;
  displayedPomodoroSecond = pomodoro.remainingSeconds;
  pomodoroPhaseLabel.elt.textContent = pomodoro.phase === 'focus' ? '專注時間' : '休息時間';
  pomodoroTimeLabel.elt.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  pomodoroRoundLabel.elt.textContent = `第 ${pomodoro.round} 輪`;
  pomodoroTimeLabel.elt.classList.toggle('break-phase', pomodoro.phase === 'break');
}

function updatePomodoroButtons() {
  pomodoroStartButton.elt.disabled = pomodoro.running;
  pomodoroPauseButton.elt.disabled = !pomodoro.running;
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.documentElement.requestFullscreen();
  }
}

function updateFullscreenState() {
  document.body.classList.toggle('is-fullscreen', Boolean(document.fullscreenElement));
  fullscreenButton.elt.textContent = document.fullscreenElement ? '⛶　離開全螢幕' : '⛶　全螢幕';
  resizeClock();
}

function resizeClock() {
  if (!clockStage) return;
  const stageWidth = clockStage.elt.clientWidth || windowWidth;
  const stageHeight = windowWidth < 600 ? 190 : 280;
  resizeCanvas(stageWidth, stageHeight);
}

function windowResized() {
  resizeClock();
}

function loadSettings() {
  const defaults = {
    subject: '',
    startTime: '',
    endTime: '',
    teacher: '',
    required: '',
    attended: '',
  };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
  } catch {
    return defaults;
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function loadBellSettings() {
  const defaults = { enabled: false, periods: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(BELL_STORAGE_KEY) || '{}');
    return {
      enabled: Boolean(saved.enabled),
      periods: Array.isArray(saved.periods)
        ? saved.periods.map((period) => ({ start: period.start || '', end: period.end || '' }))
        : defaults.periods,
    };
  } catch {
    return defaults;
  }
}

function saveBellSettings() {
  localStorage.setItem(BELL_STORAGE_KEY, JSON.stringify(bellSettings));
}

function loadPomodoroSettings() {
  const defaults = { focusMinutes: 25, breakMinutes: 5 };
  try {
    const saved = JSON.parse(localStorage.getItem(POMODORO_STORAGE_KEY) || '{}');
    return {
      focusMinutes: validDuration(saved.focusMinutes, defaults.focusMinutes),
      breakMinutes: validDuration(saved.breakMinutes, defaults.breakMinutes),
    };
  } catch {
    return defaults;
  }
}

function validDuration(value, fallback) {
  const duration = Math.floor(Number(value));
  return Number.isFinite(duration) && duration >= 1 && duration <= 180 ? duration : fallback;
}

function savePomodoroSettings() {
  localStorage.setItem(POMODORO_STORAGE_KEY, JSON.stringify(pomodoroSettings));
}

function addStyles() {
  const style = createElement('style');
  style.html(`
    :root { color-scheme: dark; font-family: "Noto Sans TC", "Microsoft JhengHei", sans-serif; background: #111619; color: #f1f5f3; }
    * { box-sizing: border-box; }
    html, body { min-width: 320px; min-height: 100%; margin: 0; background: #111619; }
    body { min-height: 100vh; }
    .app-shell { min-height: 100vh; background: radial-gradient(ellipse at 50% 34%, #1c292a 0%, #111619 58%); }
    .topbar { height: 68px; padding: 0 5vw; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #34403e; }
    .brand { color: #9ab7ae; font: 700 12px/1 monospace; letter-spacing: 2px; }
    .fullscreen-button { min-height: 40px; padding: 0 15px; border: 1px solid #53615d; border-radius: 4px; background: transparent; color: #f1f5f3; font: inherit; cursor: pointer; }
    .fullscreen-button:hover { border-color: #8fc6b4; color: #b7e5d5; }
    .tab-nav { width: min(1100px, 90vw); margin: 0 auto; display: flex; gap: 5px; border-bottom: 1px solid #34403e; }
    .tab-button { min-height: 48px; padding: 0 20px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #899994; font: inherit; cursor: pointer; }
    .tab-button:hover { color: #d5e0db; }
    .tab-button.active { border-bottom-color: #8fc6b4; color: #d7eee5; }
    .main-content { width: min(1100px, 90vw); margin: 0 auto; padding: 30px 0 24px; }
    .page-panel { display: none; }
    .page-panel.active { display: block; }
    .page-title { margin: 2px 0 26px; color: #e7efeb; font-size: 27px; font-weight: 600; }
    .date-line { color: #b2c0bb; text-align: center; font-size: clamp(17px, 2vw, 23px); font-variant-numeric: tabular-nums; }
    .clock-stage { width: 100%; height: 280px; margin-top: 8px; }
    .clock-canvas { display: block; width: 100%; height: 100%; }
    .countdown-line { min-height: 38px; margin: 0 0 30px; color: #a5c8ba; text-align: center; font-size: clamp(20px, 2.5vw, 28px); font-weight: 600; font-variant-numeric: tabular-nums; }
    .countdown-line.urgent, .countdown-line.finished { color: #ff625c; }
    .exam-info { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); border-top: 1px solid #3c4945; border-bottom: 1px solid #3c4945; }
    .info-item { min-width: 0; padding: 17px 12px 19px; border-right: 1px solid #34403e; }
    .info-item:first-child { padding-left: 0; }
    .info-item:last-child { border-right: 0; }
    .info-label { margin-bottom: 9px; color: #899994; font-size: 14px; }
    .info-value { overflow-wrap: anywhere; color: #f1f5f3; font-size: clamp(17px, 1.8vw, 22px); font-weight: 600; font-variant-numeric: tabular-nums; }
    .info-absent .info-value { color: #f1a09b; }
    .controls { margin-top: 30px; }
    .controls-title { margin-bottom: 16px; color: #a4b5af; font-size: 15px; font-weight: 600; }
    .form-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
    .field { min-width: 0; display: flex; flex-direction: column; gap: 8px; }
    .field label { color: #aebbb6; font-size: 14px; }
    .field input { width: 100%; height: 46px; padding: 0 12px; border: 1px solid #475550; border-radius: 3px; outline: none; background: #1a2223; color: #f1f5f3; font: inherit; font-variant-numeric: tabular-nums; }
    .field input:focus { border-color: #86b7a5; box-shadow: 0 0 0 2px #86b7a533; }
    .field input::placeholder { color: #687570; }
    .footer-note { margin-top: 17px; color: #687570; text-align: right; font-size: 12px; }
    .bell-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; margin-bottom: 44px; }
    .bell-play-button { min-height: 150px; border: 1px solid #618575; border-radius: 5px; background: linear-gradient(145deg, #1e3430, #172321); color: #e4f2ec; font: 600 34px/1.2 inherit; cursor: pointer; transition: background 150ms ease, transform 150ms ease; }
    .bell-play-button:hover { transform: translateY(-2px); background: #28463c; }
    .break-bell { border-color: #8f8060; background: linear-gradient(145deg, #393325, #25231d); color: #f1e8d5; }
    .break-bell:hover { background: #4b402c; }
    .schedule-heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 14px; }
    .section-title { color: #d8e2dd; font-size: 19px; font-weight: 600; }
    .schedule-actions { display: flex; align-items: center; gap: 18px; }
    .auto-toggle { color: #b6c4be; font-size: 14px; }
    .auto-toggle input { accent-color: #8fc6b4; }
    .secondary-button, .delete-button { min-height: 38px; padding: 0 12px; border: 1px solid #53615d; border-radius: 3px; background: #1a2223; color: #e5eeea; font: inherit; cursor: pointer; }
    .secondary-button:hover { border-color: #8fc6b4; }
    .status-line { margin: 10px 0 14px; color: #87938f; font-size: 13px; }
    .status-line.status-enabled { color: #9ad8bb; }
    .schedule-row { display: grid; grid-template-columns: minmax(90px, 1fr) minmax(130px, 1fr) minmax(130px, 1fr) 72px; align-items: center; gap: 12px; padding: 11px 0; border-bottom: 1px solid #2d3836; }
    .schedule-headings { padding-top: 5px; color: #7f8e88; font-size: 13px; }
    .period-name { color: #dce5e0; }
    .schedule-time { width: 100%; height: 42px; padding: 0 10px; border: 1px solid #475550; border-radius: 3px; background: #1a2223; color: #f1f5f3; font: inherit; }
    .delete-button { color: #eca7a0; }
    .delete-button:hover { border-color: #bd635c; }
    .empty-schedule { padding: 18px 0; color: #71807a; }
    .pomodoro-panel { max-width: 760px; margin: 0 auto; }
    .pomodoro-timer { padding: 35px 0 25px; text-align: center; }
    .pomodoro-phase { color: #a4c9b8; font-size: 21px; }
    .pomodoro-time { margin: 13px 0; color: #f2f5f3; font: 700 clamp(88px, 16vw, 160px)/1 monospace; font-variant-numeric: tabular-nums; }
    .pomodoro-time.break-phase { color: #e5c687; }
    .pomodoro-round { color: #9aa7a1; font-size: 18px; }
    .pomodoro-actions { display: flex; justify-content: center; flex-wrap: wrap; gap: 10px; }
    .timer-button { min-width: 100px; min-height: 46px; padding: 0 18px; border: 1px solid #53615d; border-radius: 3px; background: #1a2223; color: #e8efeb; font: inherit; cursor: pointer; }
    .timer-button:hover:not(:disabled) { border-color: #8fc6b4; }
    .timer-button:disabled { opacity: 0.45; cursor: default; }
    .timer-button.primary-action { border-color: #6a9a82; background: #294638; color: #e1f2e8; }
    .duration-settings { max-width: 480px; margin: 40px auto 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
    body.is-fullscreen .app-shell { min-height: 100vh; display: flex; flex-direction: column; background: radial-gradient(ellipse at 50% 42%, #1c292a 0%, #111619 65%); }
    body.is-fullscreen .topbar { flex: 0 0 auto; }
    body.is-fullscreen .tab-nav { display: none; }
    body.is-fullscreen .main-content { width: min(1500px, 92vw); flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 24px 0; }
    body.is-fullscreen .clock-stage { height: min(38vh, 390px); margin: 12px 0; }
    body.is-fullscreen .countdown-line { margin-bottom: 38px; font-size: clamp(26px, 3vw, 38px); }
    body.is-fullscreen .exam-info { grid-template-columns: repeat(6, minmax(0, 1fr)); }
    body.is-fullscreen .info-item { padding-top: 22px; padding-bottom: 24px; }
    body.is-fullscreen .info-label { font-size: 16px; }
    body.is-fullscreen .info-value { font-size: clamp(20px, 2.1vw, 30px); }
    body.is-fullscreen .controls, body.is-fullscreen .footer-note, body.is-fullscreen .brand { display: none; }
    @media (max-width: 700px) {
      .topbar { height: 58px; padding: 0 5vw; }
      .tab-nav { gap: 0; }
      .tab-button { flex: 1; min-height: 46px; padding: 0 5px; font-size: 13px; }
      .main-content { width: 90vw; padding-top: 25px; }
      .clock-stage { height: 190px; margin-top: 14px; }
      .countdown-line { margin-bottom: 23px; }
      .exam-info { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .info-item { padding: 13px 10px; border-bottom: 1px solid #34403e; }
      .info-item:nth-child(3) { border-right: 0; }
      .info-item:nth-child(n+4) { border-bottom: 0; }
      .info-item:first-child { padding-left: 10px; }
      .info-value { font-size: 17px; }
      .form-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 12px; }
      .page-title { font-size: 23px; }
      .bell-actions { gap: 10px; margin-bottom: 32px; }
      .bell-play-button { min-height: 112px; font-size: 25px; }
      .schedule-heading { align-items: flex-start; flex-direction: column; }
      .schedule-actions { width: 100%; justify-content: space-between; gap: 8px; }
      .schedule-row { grid-template-columns: minmax(54px, .65fr) minmax(95px, 1fr) minmax(95px, 1fr) 54px; gap: 7px; }
      .schedule-headings { font-size: 11px; }
      .schedule-time { padding: 0 4px; }
      .delete-button { padding: 0 7px; }
      .duration-settings { margin-top: 30px; gap: 12px; }
      .duration-settings .field label { font-size: 12px; }
      body.is-fullscreen .main-content { width: 92vw; }
      body.is-fullscreen .clock-stage { height: 28vh; }
      body.is-fullscreen .exam-info { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      body.is-fullscreen .info-item:nth-child(3) { border-right: 1px solid #34403e; }
      body.is-fullscreen .info-item:nth-child(2n) { border-right: 0; }
      body.is-fullscreen .info-item:nth-child(n+4) { border-bottom: 0; }
      body.is-fullscreen .info-item:nth-child(3), body.is-fullscreen .info-item:nth-child(4) { border-bottom: 1px solid #34403e; }
    }
    @media (max-width: 380px) { .form-grid { grid-template-columns: 1fr; } .tab-button { font-size: 12px; } .schedule-row { grid-template-columns: 45px minmax(85px, 1fr) minmax(85px, 1fr) 48px; gap: 5px; } }
  `);
}
