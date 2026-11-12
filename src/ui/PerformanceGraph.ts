export class PerformanceGraph {
  private readonly samples: number[] = [];
  private readonly context: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The performance graph requires a 2D canvas context.');
    this.context = context;
  }

  push(fps: number): void {
    if (!Number.isFinite(fps) || fps <= 0) return;
    this.samples.push(fps);
    if (this.samples.length > 120) this.samples.shift();
    this.draw();
  }

  private draw(): void {
    const ratio = Math.min(window.devicePixelRatio, 2);
    const width = Math.max(100, this.canvas.clientWidth);
    const height = Math.max(40, this.canvas.clientHeight);
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    const context = this.context;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const maximum = Math.max(75, ...this.samples);
    const yFor = (fps: number): number => height - 3 - (Math.min(fps, maximum) / maximum) * (height - 8);

    context.strokeStyle = 'rgba(160, 211, 204, 0.18)';
    context.lineWidth = 1;
    context.setLineDash([3, 4]);
    context.beginPath();
    context.moveTo(0, yFor(60));
    context.lineTo(width, yFor(60));
    context.stroke();
    context.setLineDash([]);

    if (this.samples.length < 2) return;
    context.strokeStyle = '#78ded2';
    context.lineWidth = 1.4;
    context.beginPath();
    this.samples.forEach((sample, index) => {
      const x = (index / Math.max(1, this.samples.length - 1)) * width;
      const y = yFor(sample);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  }
}
