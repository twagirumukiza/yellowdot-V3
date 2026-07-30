export class AnimationEngine {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.numDots = options.numDots || 16;
        this.speedMultiplier = options.speed || 1.2;
        this.dots = [];
        this.isRunning = false;
        this.animationId = null;
        this.dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
        this.width = 0;
        this.height = 0;

        this.resize();

        // ResizeObserver reacts to real layout changes of the container
        // (orientation change, virtual keyboard, header height changes...),
        // which is more reliable than the window 'resize' event alone and
        // is what was previously causing a blank/black canvas: assigning
        // canvas.width/height (even to the same value) clears the bitmap,
        // and the old code did this on every 'resize' event even while the
        // round was paused/frozen, wiping the last drawn frame.
        this._resizeHandler = () => this.resize();
        if (window.ResizeObserver) {
            this._ro = new ResizeObserver(() => this.resize());
            this._ro.observe(this.canvas.parentElement);
        } else {
            window.addEventListener('resize', this._resizeHandler);
        }
        window.addEventListener('orientationchange', this._resizeHandler);
    }

    resize() {
        const container = this.canvas.parentElement;
        const newWidth = container.clientWidth;
        const newHeight = container.clientHeight;

        if (newWidth === this.width && newHeight === this.height && this.canvas.width === Math.round(newWidth * this.dpr)) {
            return;
        }

        this.width = newWidth;
        this.height = newHeight;

        // Render at device-pixel resolution so dots stay crisp on
        // high-DPI tablets/phones instead of looking soft/blurry.
        this.canvas.width = Math.round(this.width * this.dpr);
        this.canvas.height = Math.round(this.height * this.dpr);
        this.canvas.style.width = this.width + 'px';
        this.canvas.style.height = this.height + 'px';
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

        // Keep any dots already in play inside the new bounds instead of
        // leaving them stranded off-screen after a resize/orientation change.
        if (this.dots.length) {
            for (const dot of this.dots) {
                dot.x = Math.min(Math.max(dot.x, dot.radius), Math.max(dot.radius, this.width - dot.radius));
                dot.y = Math.min(Math.max(dot.y, dot.radius), Math.max(dot.radius, this.height - dot.radius));
            }
        }

        // If we're paused/frozen (e.g. waiting for the player to click a
        // dot), redraw immediately so the resize never leaves a black canvas.
        if (!this.isRunning) {
            this.draw();
        }
    }

    initDots(targetIndex = 0, rng = Math.random) {
        this.dots = [];
        // Scale dot size/padding down on small screens (phones/small tablets)
        // so the layout stays playable instead of dots overlapping or
        // spilling past the edges.
        const minSide = Math.min(this.width, this.height) || 400;
        const radius = Math.max(10, Math.min(18, minSide * 0.035));
        const padding = Math.max(30, radius * 2.5);

        for (let i = 0; i < this.numDots; i++) {
            let x, y, overlap;
            let safety = 0;
            do {
                overlap = false;
                x = padding + rng() * Math.max(1, this.width - 2 * padding);
                y = padding + rng() * Math.max(1, this.height - 2 * padding);
                for (let other of this.dots) {
                    const dist = Math.hypot(x - other.x, y - other.y);
                    if (dist < radius * 3) {
                        overlap = true;
                        break;
                    }
                }
                safety++;
            } while (overlap && safety < 100);

            const angle = rng() * Math.PI * 2;
            const speed = (1.5 + rng() * 2) * this.speedMultiplier;

            this.dots.push({
                id: i,
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                radius: radius,
                isTarget: (i === targetIndex),
                state: 'normal', // 'normal', 'highlight', 'revealed', 'success', 'error'
                pulse: Math.random() * Math.PI
            });
        }
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        let lastTime = performance.now();

        const loop = (time) => {
            if (!this.isRunning) return;
            const dt = (time - lastTime) / 1000;
            lastTime = time;

            this.update(dt);
            this.draw();

            this.animationId = requestAnimationFrame(loop);
        };
        this.animationId = requestAnimationFrame(loop);
    }

    stop() {
        this.isRunning = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    destroy() {
        this.stop();
        if (this._ro) {
            this._ro.disconnect();
            this._ro = null;
        }
        window.removeEventListener('resize', this._resizeHandler);
        window.removeEventListener('orientationchange', this._resizeHandler);
    }

    update(dt) {
        for (let dot of this.dots) {
            dot.x += dot.vx;
            dot.y += dot.vy;

            if (dot.x - dot.radius < 0) {
                dot.x = dot.radius;
                dot.vx *= -1;
            } else if (dot.x + dot.radius > this.width) {
                dot.x = this.width - dot.radius;
                dot.vx *= -1;
            }

            if (dot.y - dot.radius < 0) {
                dot.y = dot.radius;
                dot.vy *= -1;
            } else if (dot.y + dot.radius > this.height) {
                dot.y = this.height - dot.radius;
                dot.vy *= -1;
            }

            if (Math.random() < 0.02) {
                const angleChange = (Math.random() - 0.5) * 0.5;
                const currentAngle = Math.atan2(dot.vy, dot.vx);
                const currentSpeed = Math.hypot(dot.vx, dot.vy);
                const newAngle = currentAngle + angleChange;
                dot.vx = Math.cos(newAngle) * currentSpeed;
                dot.vy = Math.sin(newAngle) * currentSpeed;
            }
        }
    }

    draw() {
        this.ctx.clearRect(0, 0, this.width, this.height);

        for (let dot of this.dots) {
            this.ctx.beginPath();
            this.ctx.arc(dot.x, dot.y, dot.radius, 0, Math.PI * 2);

            let fillColor = '#ffffff';
            let shadowColor = 'rgba(255, 255, 255, 0.3)';

            if (dot.state === 'highlight') {
                fillColor = '#eab308';
                shadowColor = 'rgba(234, 179, 8, 0.8)';
            } else if (dot.state === 'success') {
                fillColor = '#22c55e';
                shadowColor = 'rgba(34, 197, 94, 0.8)';
            } else if (dot.state === 'error') {
                fillColor = '#ef4444';
                shadowColor = 'rgba(239, 68, 68, 0.8)';
            } else if (dot.state === 'revealed') {
                fillColor = '#eab308';
                shadowColor = 'rgba(234, 179, 8, 0.8)';
            }

            this.ctx.fillStyle = fillColor;
            this.ctx.shadowColor = shadowColor;
            this.ctx.shadowBlur = dot.state !== 'normal' ? 15 : 5;
            this.ctx.fill();
            this.ctx.shadowBlur = 0;
            this.ctx.closePath();
        }
    }

    handleClick(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        for (let dot of this.dots) {
            const dist = Math.hypot(x - dot.x, y - dot.y);
            if (dist <= dot.radius + 8) {
                return dot;
            }
        }
        return null;
    }
}
