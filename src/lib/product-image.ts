export const imageSrc = (image: string) =>
  image.startsWith('/') ? image : '/images/' + image + '.webp';
