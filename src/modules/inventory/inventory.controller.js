import InventoryModel from "./inventory.model.js";
import InventorySetting from "./InventorySetting.model.js";
import ProductModel from "../products/Product.model.js";
import { VARIANT_MANAGED_STOCK_MESSAGE, hasVariantStock } from "./variant.service.js";

export const GetInventorySettings = async (req, res) => {
  try {
    const settings = await InventorySetting.getSettings();
    return res.status(200).json({
      message: "Inventory settings fetched successfully",
      data: { lowStockThreshold: settings.lowStockThreshold },
    });
  } catch (ex) {
    return res.status(500).json({ message: ex.message });
  }
};

export const UpdateInventorySettings = async (req, res) => {
  try {
    const { lowStockThreshold } = req.body;
    const value = Number(lowStockThreshold);
    if (!Number.isFinite(value) || value < 0) {
      return res.status(400).json({
        message: "Low stock threshold must be a non-negative number",
      });
    }

    const settings = await InventorySetting.getSettings();
    settings.lowStockThreshold = value;
    await settings.save();

    return res.status(200).json({
      message: "Inventory settings updated successfully",
      data: { lowStockThreshold: settings.lowStockThreshold },
    });
  } catch (ex) {
    return res.status(500).json({ message: ex.message });
  }
};

export const CreateInventory = async (req, res) => {
  try {
    const { product_id, stock, note } = req.body;

    if (!product_id) {
      return res.status(400).json({
        message: "Product id is required",
      });
    }

    if (stock === undefined || stock === null) {
      return res.status(400).json({
        message: "Stock value is required",
      });
    }

    if (isNaN(stock) || Number(stock) < 0) {
      return res.status(400).json({
        message: "Stock must be a valid number and cannot be negative",
      });
    }

    const product = await ProductModel.findById(product_id).select("stock variants");
    if (!product) {
      return res.status(404).json({
        message: "Product not found",
      });
    }

    // Same guard UpdateStock has: a variant-stocked product's total is the SUM
    // of its variants — setting it directly desynchronises the two counters.
    const hasTrackedVariants = (product.variants || []).some(
      (variant) => typeof variant.stock === "number",
    );
    if (hasTrackedVariants) {
      return res.status(409).json({
        message:
          "This product's stock is managed per variant. Edit the variant stocks on the product instead.",
        code: "STOCK_IS_VARIANT_MANAGED",
      });
    }

    const existingInventory = await InventoryModel.findOne({ product_id });
    if (existingInventory) {
      return res.status(409).json({
        message: "Inventory already exists for this product",
        data: existingInventory,
      });
    }

    const newStock = Number(stock);
    const previousStock = product.stock || 0;

    const inventory = await InventoryModel.create({
      product_id,
      stock: newStock,
      history: [
        {
          previousStock,
          newStock,
          change: newStock - previousStock,
          changedBy: req.user?.id,
          note: note || "Initial inventory insert",
        },
      ],
    });

    await ProductModel.findByIdAndUpdate(product_id, {
      $set: { stock: newStock },
    });

    return res.status(201).json({
      message: "Inventory inserted successfully",
      data: inventory,
    });
  } catch (ex) {
    console.log(ex);
    return res.status(500).json({
      message: ex.message,
    });
  }
};

export const InsertMissingInventoryFromProducts = async (req, res) => {
  try {
    const products = await ProductModel.find().select("stock").lean();
    const insertedInventory = [];
    const skippedProducts = [];

    for (const product of products) {
      const existingInventory = await InventoryModel.findOne({
        product_id: product._id,
      });

      if (existingInventory) {
        skippedProducts.push(product._id);
        continue;
      }

      const stock = Number(product.stock || 0);
      const inventory = await InventoryModel.create({
        product_id: product._id,
        stock,
        history: [
          {
            previousStock: stock,
            newStock: stock,
            change: 0,
            changedBy: req.user?.id,
            note: "Initial inventory insert from products",
          },
        ],
      });

      insertedInventory.push(inventory);
    }

    return res.status(201).json({
      message: "Missing inventory inserted successfully",
      insertedCount: insertedInventory.length,
      skippedCount: skippedProducts.length,
      data: insertedInventory,
    });
  } catch (ex) {
    console.log(ex);
    return res.status(500).json({
      message: ex.message,
    });
  }
};

export const GetAllInventory = async (req, res) => {
  try {
    const { search, category_id } = req.query;

    let inventory = await InventoryModel.find()
      .populate({
        path: "product_id",
        select: "name category_id image brand",
        populate: { path: "category_id", select: "name" },
      })
      .sort({ updatedAt: -1 })
      .lean();

    inventory = inventory.filter((item) => item.product_id);

    if (search) {
      const searchText = search.toLowerCase();
      inventory = inventory.filter((item) =>
        item.product_id.name.toLowerCase().includes(searchText),
      );
    }

    if (category_id) {
      inventory = inventory.filter(
        (item) => String(item.product_id.category_id?._id) === category_id,
      );
    }

    return res.status(200).json({
      message: "Inventory fetched successfully",
      data: inventory,
    });
  } catch (ex) {
    console.log(ex);
    return res.status(500).json({
      message: ex.message,
    });
  }
};

export const GetInventoryByProduct = async (req, res) => {
  try {
    const inventory = await InventoryModel.findOne({
      product_id: req.params.productId,
    })
      .populate("product_id", "name category_id image brand")
      .lean();

    if (!inventory) {
      return res.status(404).json({
        message: "Inventory not found for this product",
      });
    }

    return res.status(200).json({
      message: "Inventory fetched successfully",
      data: inventory,
    });
  } catch (ex) {
    console.log(ex);
    return res.status(500).json({
      message: ex.message,
    });
  }
};

export const UpdateStock = async (req, res) => {
  try {
    const { productId } = req.params;
    const { stock, note } = req.body;

    if (stock === undefined || stock === null) {
      return res.status(400).json({
        message: "Stock value is required",
      });
    }

    if (isNaN(stock) || Number(stock) < 0) {
      return res.status(400).json({
        message: "Stock must be a valid number and cannot be negative",
      });
    }

    const product = await ProductModel.findById(productId).select("stock variants");
    if (!product) {
      return res.status(404).json({
        message: "Product not found",
      });
    }

    // Same rule as the product endpoints: a variant-stocked product's total is the
    // sum of its variants and cannot be set directly here.
    if (hasVariantStock(product)) {
      return res.status(409).json({
        message: VARIANT_MANAGED_STOCK_MESSAGE,
        code: "STOCK_IS_VARIANT_MANAGED",
      });
    }

    let inventory = await InventoryModel.findOne({ product_id: productId });
    const newStock = Number(stock);

    if (!inventory) {
      const previousStock = product.stock || 0;
      inventory = new InventoryModel({
        product_id: productId,
        stock: newStock,
        history: [
          {
            previousStock,
            newStock,
            change: newStock - previousStock,
            changedBy: req.user?.id,
            note: note || "Manual stock update",
          },
        ],
      });
    } else {
      const previousStock = inventory.stock;
      inventory.stock = newStock;
      inventory.history.push({
        previousStock,
        newStock,
        change: newStock - previousStock,
        changedBy: req.user?.id,
        note: note || "Manual stock update",
      });
    }

    await inventory.save();

    await ProductModel.findByIdAndUpdate(productId, {
      $set: { stock: newStock },
    });

    return res.status(200).json({
      message: "Stock updated successfully",
      data: inventory,
    });
  } catch (ex) {
    console.log(ex);
    return res.status(500).json({
      message: ex.message,
    });
  }
};
