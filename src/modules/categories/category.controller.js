import catmodel from "./Category.model.js";
import { deleteImageAsset, saveImageAsset } from "../../utils/image-upload.js";

const toBoolean = (value) =>
  value === true || value === "true" || value === "1" || value === 1;

const clamp = (value, fallback, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, 1), max);
};

const normalizeCategoryStyles = (value) => {
  let styles = value;
  if (typeof value === "string") {
    try {
      styles = JSON.parse(value);
    } catch (_) {
      styles = {};
    }
  }

  const normalizeBlock = (block = {}, fallback) => ({
    fontFamily: block.fontFamily || fallback.fontFamily,
    fontSize: clamp(block.fontSize, fallback.fontSize, fallback.maxSize),
    fontWeight: block.fontWeight || fallback.fontWeight,
    fontStyle: block.fontStyle || fallback.fontStyle,
    textColor: block.textColor || fallback.textColor,
  });

  return {
    name: normalizeBlock(styles?.name, {
      fontFamily: "default",
      fontSize: 14,
      maxSize: 96,
      fontWeight: "semibold",
      fontStyle: "normal",
      textColor: "#1F2937",
    }),
    tagline: normalizeBlock(styles?.tagline, {
      fontFamily: "default",
      fontSize: 13,
      maxSize: 64,
      fontWeight: "normal",
      fontStyle: "normal",
      textColor: "#4B5563",
    }),
  };
};

export const CreateCategory = async (req, res) => {
  try {
    const { name, tagline, themecolor, bestseller, styles } = req.body || {};

    if (!name || !tagline || !themecolor) {
      return res.status(400).json({
        message: "All fields are required",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        message: "Image is required",
      });
    }
    console.log(req.body);

    console.log(req.file);

    const imageResult = await saveImageAsset({
      file: req.file,
      folder: "categories",
      name,
      width: 500,
      height: 500,
      quality: 80,
    });

    const category = await catmodel.create({
      name: name,
      tagline: tagline,
      themecolor: themecolor,
      bestseller: toBoolean(bestseller),
      styles: normalizeCategoryStyles(styles),
      image: imageResult.image,
      public_id: imageResult.public_id,
    });

    if (category) {
      return res.status(201).json({
        message: "Category created successfully",
        sucess: true,
      });
    } else {
      return res.status(400).json({
        message: "Category not created",
        sucess: false,
      });
    }
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: error.message });
  }
};

/// get all category

export const GetAllCategory = async (req, res) => {
  try {
    const cate = await catmodel.find().lean();

    if (cate.length === 0) {
      return res.status(200).json({
        message: "No categories found",
        data: [],
        sucess: true,
      });
    }

    return res.status(200).json({
      message: "Categories fetched successfully",
      data: cate,
      sucess: true,
    });

    if (!cate) {
      return res.status(400).json({
        message: "something went wrong",
        sucess: false,
      });
    }
  } catch (ex) {
    console.log(ex);

    return res.status(500).json({
      message: ex.message,
      sucess: false,
    });
  }
};

export const UpdateCategory = async (req, res) => {
  try {
    const cateid = req.params.categoryId;
    const { name, tagline, themecolor, bestseller, styles } = req.body || {};

    // if (!name || !tagline || !themecolor) {
    //   return res.status(400).json({
    //     message: "All fields are required",
    //   });
    // }

    if (!cateid) {
      return res.status(400).json({
        message: "Category id is required",
      });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (tagline !== undefined) updateData.tagline = tagline;
    if (themecolor !== undefined) updateData.themecolor = themecolor;
    if (bestseller !== undefined) updateData.bestseller = toBoolean(bestseller);
    if (styles !== undefined) updateData.styles = normalizeCategoryStyles(styles);

    if (req.file) {
      const existingCategory = await catmodel.findById(cateid);
      if (!existingCategory) {
        return res.status(404).json({
          message: "Category not found",
          sucess: false,
        });
      }

      const imageResult = await saveImageAsset({
        file: req.file,
        folder: "categories",
        name: name || existingCategory.name,
        width: 500,
        height: 500,
        quality: 80,
      });

      await deleteImageAsset(existingCategory.public_id);

      updateData.image = imageResult.image;
      updateData.public_id = imageResult.public_id;
    }

    const cate = await catmodel.updateOne({ _id: cateid }, updateData);
    if (cate) {
      return res.status(200).json({
        message: "Category updated successfully",
        sucess: true,
      });
    } else {
      return res.status(400).json({
        message: "Category not updated",
        sucess: false,
      });
    }
  } catch (ex) {
    console.log(ex);
    return res.status(500).json({
      message: ex.message,
      sucess: false,
    });
  }
};

// delete

export const DeleteCategory = async (req, res) => {
  try {
    const cateid = req.params.categoryId;
    const cate = await catmodel.findByIdAndDelete(cateid);
    if (cate) {
      await deleteImageAsset(cate.public_id);

      return res.status(200).json({
        message: "Category deleted successfully",
        sucess: true,
      });
    }
    return res.status(400).json({
      message: "Category not deleted",
      sucess: false,
    });
  } catch (ex) {
    console.log(ex);
    return res.status(500).json({
      message: ex.message,
      sucess: false,
    });
  }
};
