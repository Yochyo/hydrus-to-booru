import * as fs from 'fs';
import sharp from 'sharp';

const

void (async  () => {
  const a = fs.readFileSync('files/sample_9e20ea741ddcff5d2962e446f9733c2f9cc74b7f.jpg')
  await sharp(a).resize({height: 200}).toFile('temp.png')
})()