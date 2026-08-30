const container = document.getElementById('canvas-container');
if (container == null) {
  throw new Error('Missing canvas-container element');
}

const canvas = document.createElement('canvas');
canvas.id = 'game-canvas';
container.appendChild(canvas);

const ctx = canvas.getContext('2d');
if (ctx == null) {
  throw new Error('Could not obtain 2D context');
}

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function draw(context: CanvasRenderingContext2D) {
  context.fillStyle = '#000000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#ffffff';
  context.font = '24px sans-serif';
  context.textAlign = 'center';
  context.fillText('Wolfenstein Clone', canvas.width / 2, canvas.height / 2);
}

window.addEventListener('resize', resize);
resize();
draw(ctx);
