export type ActivityMedia = {
  id: string;
  batch_id: string;
  name: string;
  mime: string;
  created_at: string;
};
export type ActivityMediaBatch = { id: string; files: File[] };

const megabyte = 1024 * 1024;

async function screenshotBlob(file: Blob): Promise<Blob> {
  const { imageDimensions, checkDimensions, screenshotLimits } = await import('@/lib/athlete-ocr');
  if (file.size > screenshotLimits.bytes) throw new Error('Choose screenshots under 10 MB each.');
  const dimensions = imageDimensions(new Uint8Array(await file.arrayBuffer()));
  if (!dimensions) throw new Error('Choose readable PNG, JPEG or WebP screenshots.');
  checkDimensions(dimensions);
  const image = await createImageBitmap(file).catch(() => { throw new Error('Choose readable PNG, JPEG or WebP screenshots.'); });
  try {
    const scale = Math.min(1, 1920 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not prepare the screenshot.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) =>
      blob ? resolve(blob) : reject(new Error('Could not prepare the screenshot.')), 'image/jpeg', 0.86));
  } finally {
    image.close();
  }
}

function asBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1]);
    reader.onerror = () => reject(new Error('Could not read the attachment.'));
    reader.readAsDataURL(blob);
  });
}

export async function prepareActivityMedia(inputs: File[]) {
  if (!inputs.length || inputs.length > 24) throw new Error('Choose between 1 and 24 activity attachments.');
  const media: { name: string; mime: string; data: string }[] = [];
  let bytes = 0;
  for (const input of inputs) {
    const blob = await screenshotBlob(input);
    bytes += blob.size;
    if (!blob.size || blob.size > 4 * megabyte || bytes > 12 * megabyte) {
      throw new Error('Choose attachments under 4 MB each and 12 MB in total.');
    }
    media.push({ name: Array.from(input.name.trim() || 'Screenshot').slice(0, 120).join(''), mime: blob.type, data: await asBase64(blob) });
  }
  return media;
}
