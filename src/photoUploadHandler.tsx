import type { ChangeEvent } from 'react';
import { compressImage } from './utils/compressImage';

const handlePhotoUpload = async (
  event: ChangeEvent<HTMLInputElement>,
  setDeliveryPhoto: (f: File | null) => void,
  setDeliveryPhotoPreview: (url: string | null) => void,
  setUploadingPhoto: (v: boolean) => void,
) => {
  const file = event.target.files?.[0];

  if (!file) return;

  try {
    setUploadingPhoto(true);

    const { file: compressedFile, preview } = await compressImage(file);

    // Update state with compressed file and preview
    setDeliveryPhoto(compressedFile);
    setDeliveryPhotoPreview(preview);

    setUploadingPhoto(false);
  } catch (error: unknown) {
    setUploadingPhoto(false);
    const msg = error instanceof Error ? error.message : String(error);
    alert('Failed to upload photo: ' + msg);
    event.target.value = ''; // Reset file input
  }
};