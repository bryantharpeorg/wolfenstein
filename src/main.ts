function mountCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.id = 'render-canvas';
  document.body.appendChild(canvas);
  return canvas;
}

const canvas = mountCanvas();

// eslint-disable-next-line no-console
console.log('Canvas mounted:', canvas.id);
