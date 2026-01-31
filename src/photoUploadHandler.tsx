import { compressImage } from './utils/compressImage';

const handlePhotoUpload = async (event, setDeliveryPhoto, setDeliveryPhotoPreview, setUploadingPhoto) => {
  const file = event.target.files[0];

  if (!file) return;

  try {
    setUploadingPhoto(true);

    const { file: compressedFile, preview } = await compressImage(file);

    // Update state with compressed file and preview
    setDeliveryPhoto(compressedFile);
    setDeliveryPhotoPreview(preview);

    setUploadingPhoto(false);
  } catch (error) {
    setUploadingPhoto(false);
    alert('Failed to upload photo: ' + error.message);
    event.target.value = ''; // Reset file input
  }
};