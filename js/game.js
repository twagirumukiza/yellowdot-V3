import { SoloGame } from './solo.js';
import { audio } from './audio.js';

class AppController {
    constructor() {
        this.currentScreen = 'screen-menu';
        this.activeGame = null;   // currently running SoloGame/online round instance
        this.isOnlineRound = false; // true while an online round is in progress
        this.onlineManager = null; // created lazily on first "Jouer en ligne" click
        this.stats = {
            totalGames: 0,
            wins: 0,
            precisionSum: 0,
            bestStreak: 0
        };
        this.loadStats();
        this.initListeners();
    }

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
        document.getElementById(screenId).classList.remove('hidden');
        this.currentScreen = screenId;
    }

    async getOnlineManager() {
        if (!this.onlineManager) {
            // Loaded on demand: if Firebase/network fails here, it only
            // affects the online screen, never Solo/Stats/Rules/Settings.
            const { OnlineManager } = await import('./online.js');
            this.onlineManager = new OnlineManager(this);
        }
        return this.onlineManager;
    }

    initListeners() {
        // Menu navigation
        document.getElementById('btn-solo').onclick = () => {
            audio.playClick();
            this.showScreen('screen-solo-setup');
        };
        document.getElementById('btn-online').onclick = async () => {
            audio.playClick();
            this.showScreen('screen-online');
            const manager = await this.getOnlineManager();
            manager.init();
        };
        document.getElementById('btn-stats').onclick = () => {
            audio.playClick();
            this.updateStatsUI();
            this.showScreen('screen-stats');
        };
        document.getElementById('btn-rules').onclick = () => {
            audio.playClick();
            this.showScreen('screen-rules');
        };
        document.getElementById('btn-settings').onclick = () => {
            audio.playClick();
            this.showScreen('screen-settings');
        };

        // Back buttons
        document.getElementById('btn-solo-back').onclick = () => { audio.playClick(); this.showScreen('screen-menu'); };
        document.getElementById('btn-stats-back').onclick = () => { audio.playClick(); this.showScreen('screen-menu'); };
        document.getElementById('btn-rules-back').onclick = () => { audio.playClick(); this.showScreen('screen-menu'); };
        document.getElementById('btn-settings-back').onclick = () => { audio.playClick(); this.showScreen('screen-menu'); };

        // Pill selectors helper
        this.setupPillSelectors();

        // Solo start
        document.getElementById('btn-solo-start').onclick = () => {
            audio.playClick();
            const numDots = parseInt(document.querySelector('#select-dots .pill.active').dataset.val);
            const speed = parseFloat(document.querySelector('#select-speed .pill.active').dataset.val);
            const obsTime = parseInt(document.querySelector('#select-time .pill.active').dataset.val);

            this.isOnlineRound = false;
            this.showScreen('screen-game');
            this.startSoloGame({ numDots, speed, obsTime });
        };

        // In-game top buttons
        document.getElementById('btn-home').onclick = () => {
            audio.playClick();
            this.exitActiveGame();
        };
        document.getElementById('btn-pause-toggle').onclick = () => {
            audio.playClick();
            if (this.isOnlineRound) return; // pausing a competitive online round isn't fair, ignore
            if (this.activeGame) this.activeGame.stop();
            document.getElementById('modal-pause').classList.remove('hidden');
        };
        document.getElementById('btn-quit').onclick = () => {
            audio.playClick();
            this.exitActiveGame();
        };

        // Pause modal buttons
        document.getElementById('btn-resume').onclick = () => {
            audio.playClick();
            document.getElementById('modal-pause').classList.add('hidden');
            if (this.activeGame) this.activeGame.engine.start();
        };
        document.getElementById('btn-abandon').onclick = () => {
            audio.playClick();
            document.getElementById('modal-pause').classList.add('hidden');
            this.exitActiveGame();
        };

        // Settings toggles
        document.getElementById('setting-music').onchange = (e) => {
            audio.musicEnabled = e.target.checked;
        };
        document.getElementById('setting-sfx').onchange = (e) => {
            audio.sfxEnabled = e.target.checked;
        };
    }

    // Leaving mid-game: online rounds return to the room lobby (so you
    // don't lose your seat), solo games return to the main menu.
    exitActiveGame() {
        if (this.activeGame) this.activeGame.stop();
        if (this.isOnlineRound) {
            this.isOnlineRound = false;
            this.showScreen('screen-online');
        } else {
            this.showScreen('screen-menu');
        }
    }

    setupPillSelectors() {
        document.querySelectorAll('.pill-selector').forEach(selector => {
            selector.querySelectorAll('.pill').forEach(pill => {
                pill.onclick = () => {
                    audio.playClick();
                    selector.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
                    pill.classList.add('active');
                };
            });
        });
    }

    startSoloGame(config) {
        this.activeGame = new SoloGame(config, (score, levels) => {
            this.recordGameStats(score, levels);
        });
        this.activeGame.startRound();
    }

    // Called by OnlineManager once the host starts a round: everyone in
    // the room plays the same config/target/rng, then onRoundEnd reports
    // the outcome back so it can be written to the room in Firebase.
    startOnlineGame(config, targetIndex, rng, onRoundEnd) {
        this.isOnlineRound = true;
        this.showScreen('screen-game');
        this.activeGame = new SoloGame(config, null, {
            mode: 'online',
            targetIndex,
            rng,
            onRoundEnd: (correct, timeMs, score) => {
                this.isOnlineRound = false;
                onRoundEnd(correct, timeMs, score);
            }
        });
        this.activeGame.startRound();
    }

    recordGameStats(score, levels) {
        this.stats.totalGames++;
        if (levels > 0) this.stats.wins++;
        if (levels > this.stats.bestStreak) this.stats.bestStreak = levels;
        this.saveStats();
    }

    loadStats() {
        const saved = localStorage.getItem('yellow_dot_stats');
        if (saved) {
            try { this.stats = JSON.parse(saved); } catch(e){}
        }
    }

    saveStats() {
        localStorage.setItem('yellow_dot_stats', JSON.stringify(this.stats));
    }

    updateStatsUI() {
        const precision = this.stats.totalGames > 0 ? Math.round((this.stats.wins / this.stats.totalGames) * 100) : 0;
        document.getElementById('stat-precision').textContent = `${precision}%`;
        document.getElementById('stat-avg-time').textContent = `2.1s`;
        document.getElementById('stat-streak').textContent = this.stats.bestStreak;
        document.getElementById('stat-wins').textContent = this.stats.wins;
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new AppController();
});
