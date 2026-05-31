"""
EXIF orientation correction utility.
"""

from PIL import ImageOps

ORIENTATION_TAG = 0x0112  # EXIF tag ID for Orientation


def auto_rotate(img):
    """
    Correct a Pillow Image's orientation using its EXIF Orientation tag.

    Returns (corrected_image, was_rotated: bool).
    If no correction is needed (orientation is 1 or absent), returns the
    original image object unchanged and was_rotated=False.
    Handles missing or corrupt EXIF data gracefully.
    """
    try:
        orientation = img.getexif().get(ORIENTATION_TAG, 1)
    except Exception:
        return img, False

    if orientation in (0, 1):
        return img, False

    # ImageOps.exif_transpose applies the correct transform for all 8
    # EXIF orientation values and resets the tag to 1 in the output image.
    return ImageOps.exif_transpose(img), True
