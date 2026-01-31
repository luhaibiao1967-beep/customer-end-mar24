export const compressImage = async (file, maxSizeKB = 300) => {
  return new Promise((resolve, reject) => {
    // Validate file type
    if (!file.type.startsWith('image/')) {
      reject(new Error('Invalid file type. Please select an image.'));
      return;
    }

    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error('Failed to read the image file.'));
    };

    reader.onload = (event) => {
      const img = new Image();

      img.onerror = () => {
        reject(new Error('Failed to load the image.'));
      };

      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');

          if (!ctx) {
            reject(new Error('Canvas context is not available.'));
            return;
          }

          // Resize dimensions while maintaining aspect ratio
          let width = img.width;
          let height = img.height;
          const maxDimension = 2048;

          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = (height * maxDimension) / width;
              width = maxDimension;
            } else {
              width = (width * maxDimension) / height;
              height = maxDimension;
            }
          }

          canvas.width = width;
          canvas.height = height;

          // Draw image on the canvas and compress it
          ctx.drawImage(img, 0, 0, width, height);

          let quality = 1;
          let compressedDataUrl = canvas.toDataURL('image/jpeg', quality);

          while ((compressedDataUrl.length * 3) / 4 > maxSizeKB * 1024 && quality > 0.1) {
            quality -= 0.1;
            compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
          }

          const compressedBlob = dataURLtoBlob(compressedDataUrl);
          const compressedFile = new File([compressedBlob], file.name, {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });

          resolve({ file: compressedFile, preview: compressedDataUrl });
        } catch (err) {
          reject(new Error('Compression failed: ' + err.message));
        }
      };

      img.src = event.target.result;
    };

    reader.readAsDataURL(file);
  });
};

const dataURLtoBlob = (dataURL) => {
  const parts = dataURL.split(',');
  const mime = parts[0].match(/:(.*?);/)[1];
  const binaryData = atob(parts[1]);
  const byteArray = new Uint8Array(binaryData.length);

  for (let i = 0; i < binaryData.length; i++) {
    byteArray[i] = binaryData.charCodeAt(i);
  }

  return new Blob([byteArray], { type: mime });
};