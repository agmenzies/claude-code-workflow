import sharp from 'sharp';

await sharp('media/icon.svg')
  .resize(256, 256)
  .png()
  .toFile('media/icon.png');

console.log('media/icon.png created (256x256)');
