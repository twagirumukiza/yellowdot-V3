import { audio } from './audio.js';

// Deterministic PRNG (mulberry32) so every player in a room gets the exact
// same dot layout/target for a given round seed — needed for a fair
// multiplayer round since AnimationEngine.initDots() takes an rng function.
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Firebase Realtime Database keys can't contain '.', '#', '$', '[', ']', '/'.
// The old code used the raw username as a DB key/path segment, so a pseudo
// containing any of those characters made every write fail silently and
// the room would never update — this sanitizes it defensively.
function sanitizeKey(str) {
    const cleaned = str.replace(/[.#$\[\]/]/g, '_').trim();
    return cleaned || 'joueur';
}

export class OnlineManager {
    constructor(appController) {
        this.app = appController;
        this.username = '';
        this.roomId = null;
        this.isHost = false;
        this.unsubRoom = null;
        this.unsubRoomsList = null;
        this.lastStartedSeed = null;
        this.db = null;
        this.dbFns = null; // { ref, set, get, push, update, onValue, remove }
        this.connectPromise = null;
        this.config = { numDots: 16, speed: 1.2, obsTime: 2 };
    }

    showError(msg) {
        const el = document.getElementById('online-error');
        el.textContent = msg;
        el.classList.remove('hidden');
    }

    clearError() {
        document.getElementById('online-error').classList.add('hidden');
    }

    // Loaded on first use only, so a Firebase/network problem never breaks
    // anything outside the "Jouer en ligne" screen.
    async connectFirebase() {
        if (this.db) return true;
        if (!this.connectPromise) {
            this.connectPromise = import('../firebase/firebase-config.js')
                .then(({ loadFirebase }) => loadFirebase())
                .then(({ db, dbModule }) => {
                    this.db = db;
                    this.dbFns = dbModule;
                    return true;
                })
                .catch((err) => {
                    console.error('Firebase load failed:', err);
                    this.showError("Impossible de se connecter au serveur en ligne. Vérifiez votre connexion internet (certains bloqueurs de publicité/VPN bloquent aussi ce service), puis réessayez.");
                    this.connectPromise = null;
                    return false;
                });
        }
        return this.connectPromise;
    }

    init() {
        this.clearError();
        const btnLogin = document.getElementById('btn-login-online');
        const btnCreate = document.getElementById('btn-create-room');
        const btnLeave = document.getElementById('btn-leave-room');
        const btnBack = document.getElementById('btn-online-back');
        const btnStart = document.getElementById('btn-start-room');

        btnLogin.onclick = async () => {
            const val = document.getElementById('input-username').value.trim();
            if (!val) return;
            audio.playClick();
            this.clearError();
            const ok = await this.connectFirebase();
            if (!ok) return;
            this.username = sanitizeKey(val);
            document.getElementById('lobby-auth').classList.add('hidden');
            document.getElementById('lobby-menu').classList.remove('hidden');
            this.listenRooms();
        };

        btnCreate.onclick = () => { audio.playClick(); this.createRoom(); };
        btnLeave.onclick = () => { audio.playClick(); this.leaveRoom(); };
        btnStart.onclick = () => { audio.playClick(); this.startRoom(); };
        btnBack.onclick = () => {
            audio.playClick();
            if (this.unsubRoomsList) this.unsubRoomsList();
            this.leaveRoom();
            this.app.showScreen('screen-menu');
        };

        this.setupHostConfigSelectors();
    }

    setupHostConfigSelectors() {
        const map = {
            'online-select-dots': 'numDots',
            'online-select-speed': 'speed',
            'online-select-time': 'obsTime'
        };
        Object.entries(map).forEach(([selectorId, key]) => {
            const selector = document.getElementById(selectorId);
            selector.querySelectorAll('.pill').forEach(pill => {
                pill.onclick = () => {
                    if (!this.isHost) return;
                    audio.playClick();
                    selector.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
                    pill.classList.add('active');
                    const val = key === 'numDots' ? parseInt(pill.dataset.val) : parseFloat(pill.dataset.val);
                    this.config = { ...this.config, [key]: val };
                    if (this.roomId && this.isHost) {
                        this.dbFns.update(this.dbFns.ref(this.db, `rooms/${this.roomId}`), { config: this.config });
                    }
                };
            });
        });
    }

    listenRooms() {
        const { ref, onValue } = this.dbFns;
        const roomsRef = ref(this.db, 'rooms');
        this.unsubRoomsList = onValue(roomsRef, (snapshot) => {
            const data = snapshot.val();
            const listEl = document.getElementById('room-list');
            listEl.innerHTML = '';
            if (!data) {
                listEl.innerHTML = '<p>Aucun salon disponible.</p>';
                return;
            }
            for (let id in data) {
                const room = data[id];
                if (room.status === 'waiting') {
                    const div = document.createElement('div');
                    div.className = 'room-item';
                    div.innerHTML = `<span>Salon de ${room.host}</span><span>Rejoindre ➔</span>`;
                    div.onclick = () => this.joinRoom(id);
                    listEl.appendChild(div);
                }
            }
        }, (err) => {
            console.error(err);
            this.showError("Connexion au serveur perdue. Réessayez.");
        });
    }

    createRoom() {
        const { ref, push, set } = this.dbFns;
        const roomsRef = ref(this.db, 'rooms');
        const newRoomRef = push(roomsRef);
        this.roomId = newRoomRef.key;
        this.isHost = true;
        this.lastStartedSeed = null;

        const roomData = {
            host: this.username,
            status: 'waiting',
            config: this.config,
            players: {
                [this.username]: { score: 0, ready: true }
            }
        };

        set(newRoomRef, roomData)
            .then(() => {
                this.enterRoomUI();
                this.listenRoomData();
            })
            .catch((err) => {
                console.error(err);
                this.showError("Impossible de créer le salon. Réessayez.");
            });
    }

    joinRoom(roomId) {
        const { ref, set } = this.dbFns;
        this.roomId = roomId;
        this.isHost = false;
        this.lastStartedSeed = null;
        const playerRef = ref(this.db, `rooms/${roomId}/players/${this.username}`);
        set(playerRef, { score: 0, ready: true })
            .then(() => {
                this.enterRoomUI();
                this.listenRoomData();
            })
            .catch((err) => {
                console.error(err);
                this.showError("Impossible de rejoindre ce salon. Réessayez.");
            });
    }

    enterRoomUI() {
        document.getElementById('lobby-menu').classList.add('hidden');
        document.getElementById('lobby-room').classList.remove('hidden');
        document.getElementById('host-name').textContent = this.isHost ? this.username : 'Salon';
        document.getElementById('host-config').classList.toggle('hidden', !this.isHost);
        document.getElementById('btn-start-room').classList.toggle('hidden', !this.isHost);
    }

    renderConfigSummary(config) {
        const labelSpeed = { 0.5: 'Très lente', 0.8: 'Lente', 1.2: 'Normale', 1.8: 'Rapide', 2.5: 'Extrême' };
        const box = document.getElementById('room-settings-box');
        box.textContent = `Réglages : ${config.numDots} points · vitesse ${labelSpeed[config.speed] || config.speed} · observation ${config.obsTime}s`;
    }

    listenRoomData() {
        const { ref, onValue } = this.dbFns;
        const roomRef = ref(this.db, `rooms/${this.roomId}`);
        this.unsubRoom = onValue(roomRef, (snapshot) => {
            const data = snapshot.val();
            if (!data) {
                // Room was deleted (e.g. host left) — send everyone back out.
                this.roomId = null;
                document.getElementById('lobby-room').classList.add('hidden');
                document.getElementById('lobby-menu').classList.remove('hidden');
                return;
            }

            if (data.config) {
                this.config = data.config;
                this.renderConfigSummary(data.config);
            }

            const playersUl = document.getElementById('players-ul');
            playersUl.innerHTML = '';
            if (data.players) {
                for (let p in data.players) {
                    const player = data.players[p];
                    const li = document.createElement('li');
                    let resultHtml = '';
                    if (player.result) {
                        const cls = player.result.correct ? 'correct' : 'wrong';
                        const label = player.result.correct ? `✔ ${player.result.timeMs}ms` : '✘';
                        resultHtml = `<span class="player-result ${cls}">${label}</span>`;
                    }
                    li.innerHTML = `• ${p}${resultHtml}`;
                    playersUl.appendChild(li);
                }
            }

            // A new round started: everyone (host included) launches it once.
            if (data.status === 'playing' && data.seed != null && data.seed !== this.lastStartedSeed) {
                this.lastStartedSeed = data.seed;
                this.launchRound(data.config || this.config, data.target || 0, data.seed);
            }

            if (this.isHost) {
                const btnStart = document.getElementById('btn-start-room');
                btnStart.textContent = data.status === 'waiting' ? 'Démarrer la partie' : '🔄 Relancer une manche';
            }
        }, (err) => {
            console.error(err);
            this.showError("Connexion au salon perdue.");
        });
    }

    startRoom() {
        if (!this.isHost || !this.roomId) return;
        const { ref, update } = this.dbFns;
        const numDots = this.config.numDots || 16;
        const seed = Date.now() % 2147483647;
        const rng = mulberry32(seed);
        const target = Math.floor(rng() * numDots);

        // Clear previous results and kick off a fresh, synced round for
        // everyone currently in the room.
        const updates = {
            status: 'playing',
            seed,
            target,
            config: this.config
        };
        update(ref(this.db, `rooms/${this.roomId}`), updates).catch((err) => {
            console.error(err);
            this.showError("Impossible de démarrer la partie.");
        });

        // Also clear each player's previous result.
        const { get } = this.dbFns;
        get(ref(this.db, `rooms/${this.roomId}/players`)).then((snap) => {
            const players = snap.val() || {};
            Object.keys(players).forEach((p) => {
                update(ref(this.db, `rooms/${this.roomId}/players/${p}`), { result: null });
            });
        }).catch(() => {});
    }

    launchRound(config, target, seed) {
        const rng = mulberry32(seed ^ 0x9e3779b9);
        this.app.startOnlineGame(config, target, rng, (correct, timeMs, score) => {
            this.reportResult(correct, timeMs, score);
        });
    }

    reportResult(correct, timeMs, score) {
        if (!this.roomId || !this.username) {
            this.app.showScreen('screen-online');
            return;
        }
        const { ref, update } = this.dbFns;
        update(ref(this.db, `rooms/${this.roomId}/players/${this.username}`), {
            score,
            result: { correct, timeMs }
        }).catch((err) => console.error(err));
        this.app.showScreen('screen-online');
    }

    leaveRoom() {
        if (this.unsubRoom) {
            this.unsubRoom();
            this.unsubRoom = null;
        }
        if (this.roomId && this.username && this.dbFns) {
            const { ref, remove, get } = this.dbFns;
            if (this.isHost) {
                // Host leaving closes the room for everyone.
                remove(ref(this.db, `rooms/${this.roomId}`)).catch(() => {});
            } else {
                remove(ref(this.db, `rooms/${this.roomId}/players/${this.username}`)).catch(() => {});
            }
            this.roomId = null;
        }
        document.getElementById('lobby-room').classList.add('hidden');
        document.getElementById('lobby-menu').classList.remove('hidden');
    }
}
