import { AnimationEngine } from './animation.js';
import { audio } from './audio.js';

/**
 * Drives a round of play on the canvas.
 *
 * mode: 'solo'   -> classic endless levels, random target each round (default)
 * mode: 'online' -> a single round with a target/rng provided by the room
 *                   (so every player in the room gets the same layout),
 *                   reporting the outcome back via onRoundEnd(correct, timeMs, score)
 */
export class SoloGame {
    constructor(config, onGameOver, opts = {}) {
        this.config = config; // { numDots, speed, obsTime }
        this.onGameOver = onGameOver;
        this.mode = opts.mode || 'solo';
        this.targetIndex = opts.targetIndex;
        this.rng = opts.rng || Math.random;
        this.onRoundEnd = opts.onRoundEnd || null;

        this.canvas = document.getElementById('game-canvas');
        this.engine = new AnimationEngine(this.canvas, {
            numDots: config.numDots,
            speed: config.speed
        });

        this.level = 1;
        this.score = 0;
        this.state = 'observing'; // 'observing', 'moving', 'waiting_stop', 'result'
        this.movingStartedAt = null;

        this.setupUI();
    }

    setupUI() {
        const btnStop = document.getElementById('btn-stop');
        btnStop.classList.add('hidden');

        // Remove old listeners by cloning
        const newBtnStop = btnStop.cloneNode(true);
        btnStop.parentNode.replaceChild(newBtnStop, btnStop);

        document.getElementById('btn-stop').addEventListener('click', () => this.handleStop());

        // Tear down the previous engine's observers/listeners before we
        // swap the canvas node, otherwise every new round leaked a
        // ResizeObserver/'resize' listener bound to a detached canvas.
        this.engine.destroy();

        const newCanvas = this.canvas.cloneNode(true);
        this.canvas.parentNode.replaceChild(newCanvas, this.canvas);
        this.canvas = newCanvas;
        this.engine.canvas = this.canvas;
        this.engine.ctx = this.canvas.getContext('2d');
        this.engine.width = 0;
        this.engine.height = 0;
        this.engine.resize();
        // Re-attach the observers on the fresh canvas node.
        if (window.ResizeObserver) {
            this.engine._ro = new ResizeObserver(() => this.engine.resize());
            this.engine._ro.observe(this.canvas.parentElement);
        } else {
            window.addEventListener('resize', this.engine._resizeHandler);
        }

        const onPointer = (e) => {
            e.preventDefault();
            const point = e.changedTouches ? e.changedTouches[0] : e;
            this.handleCanvasClick(point.clientX, point.clientY);
        };
        this.canvas.addEventListener('click', (e) => this.handleCanvasClick(e.clientX, e.clientY));
        this.canvas.addEventListener('touchend', onPointer, { passive: false });
    }

    startRound() {
        this.state = 'observing';
        document.getElementById('info-level').textContent = this.mode === 'online' ? 'Manche unique' : `Niveau : ${this.level}`;
        document.getElementById('info-score').textContent = `Score : ${this.score}`;
        document.getElementById('info-status').textContent = 'Observez le point jaune...';
        document.getElementById('btn-stop').classList.add('hidden');

        const targetIndex = (this.mode === 'online' && this.targetIndex != null)
            ? this.targetIndex
            : Math.floor(Math.random() * this.config.numDots);

        this.engine.initDots(targetIndex, this.rng);

        for (let dot of this.engine.dots) {
            if (dot.id === targetIndex) {
                dot.state = 'highlight';
            }
        }

        this.engine.start();

        this._obsTimeout = setTimeout(() => {
            if (!this.engine.isRunning) return;
            for (let dot of this.engine.dots) {
                if (dot.state === 'highlight') {
                    dot.state = 'normal';
                }
            }
            this.state = 'moving';
            this.movingStartedAt = performance.now();
            document.getElementById('info-status').textContent = 'Suivez les points du regard...';
            document.getElementById('btn-stop').classList.remove('hidden');
        }, this.config.obsTime * 1000);
    }

    handleStop() {
        if (this.state !== 'moving') return;
        this.state = 'waiting_stop';
        this.engine.stop();
        document.getElementById('btn-stop').classList.add('hidden');
        document.getElementById('info-status').textContent = 'Cliquez sur le bon point !';
    }

    handleCanvasClick(clientX, clientY) {
        if (this.state !== 'waiting_stop') return;

        const clickedDot = this.engine.handleClick(clientX, clientY);
        if (!clickedDot) return;

        this.state = 'result';

        let trueTarget = null;
        for (let dot of this.engine.dots) {
            if (dot.isTarget) {
                trueTarget = dot;
                break;
            }
        }

        const timeMs = this.movingStartedAt ? Math.round(performance.now() - this.movingStartedAt) : null;
        const correct = !!clickedDot.isTarget;

        if (correct) {
            audio.playSuccess();
            clickedDot.state = 'success';
        } else {
            audio.playError();
            clickedDot.state = 'error';
            if (trueTarget) trueTarget.state = 'revealed';
        }

        if (this.mode === 'online') {
            this.score = correct ? Math.max(10, 1000 - (timeMs || 0)) : 0;
            document.getElementById('info-status').textContent = correct ? 'Bonne réponse !' : 'Mauvaise réponse.';
            this.engine.start();
            setTimeout(() => {
                this.engine.stop();
                if (this.onRoundEnd) this.onRoundEnd(correct, timeMs, this.score);
            }, 1200);
            return;
        }

        // Solo mode: classic endless levels
        if (correct) {
            this.score += 10 * this.level;
            this.level += 1;
            document.getElementById('info-status').textContent = 'Victoire ! Niveau suivant...';
            this.engine.start();
            setTimeout(() => {
                this.engine.stop();
                this.startRound();
            }, 1200);
        } else {
            this.engine.start();
            document.getElementById('info-status').textContent = 'Défaite ! Mauvais point.';
            setTimeout(() => {
                this.engine.stop();
                if (this.onGameOver) this.onGameOver(this.score, this.level - 1);
            }, 2000);
        }
    }

    stop() {
        clearTimeout(this._obsTimeout);
        this.engine.destroy();
    }
}
