import Product from "./Product.model.js";
import productModel from "./Product.model.js";
import { deleteImageAsset, saveImageAsset } from "../../utils/image-upload.js";
import {
  addDeliveryDays,
  attachReviewSummary,
  escapeRegex,
  fuzzyScore,
  getDeliveryRange,
  normalizeProductStyles,
  normalizeVariants,
  toBoolean,
  trackSearch,
} from "./product-query.service.js";
import { buildSeoFields } from "./product-seo.service.js";

export const CreateProduct = async (req, res) => {
  try {
    const {
      name,
      description,
      price,
      mrp,
      category_id,
      size,
      brand,
      stock,
      producthightlight,
      bestseller,
      styles,
      variants,
      metaTitle,
      metaDescription,
      metaKeywords,
      slug,
    } = req.body;

    const missingFields = [];
    if (!name?.trim()) missingFields.push("name");
    if (!description?.trim()) missingFields.push("description");
    if (!price) missingFields.push("price");
    if (!category_id) missingFields.push("category");
    if (!brand?.trim()) missingFields.push("brand");
    if (!producthightlight?.trim()) missingFields.push("product highlights");
    if (stock === undefined || stock === "") missingFields.push("stock");

    if (missingFields.length > 0) {
      return res.status(400).json({
        message: `Missing required fields: ${missingFields.join(", ")}`,
      });
    }

    const productPrice = Number(price);
    const productMrp = mrp === undefined || mrp === "" ? productPrice : Number(mrp);
    const productStock = Number(stock);

    if (!Number.isFinite(productPrice) || productPrice < 0) {
      return res.status(400).json({ message: "Price cannot be negative" });
    }
    if (!Number.isFinite(productMrp) || productMrp < 0) {
      return res.status(400).json({ message: "MRP cannot be negative" });
    }
    if (!Number.isInteger(productStock) || productStock < 0) {
      return res.status(400).json({
        message: "Stock must be a non-negative whole number",
      });
    }

    console.log(req.body);

    if (!req.file) {
      return res.status(400).json({
        message: "Image is required",
      });
    }

    const imageResult = await saveImageAsset({
      file: req.file,
      folder: "products",
      name,
      width: 500,
      height: 500,
      quality: 80,
    });

    const product = await Product.create({
      name,
      description,
      price: productPrice,
      mrp: Number.isNaN(productMrp) ? productPrice : productMrp,
      category_id,
      size,
      brand,
      producthightlight,
      styles: normalizeProductStyles(styles),
      variants: normalizeVariants(variants) || [],
      stock: productStock,
      bestseller: toBoolean(bestseller),

      image: imageResult.image,
      public_id: imageResult.public_id,

      ...buildSeoFields({ metaTitle, metaDescription, metaKeywords, slug, name }),
    });

    // product.save();

    if (!product) {
      return res.status(400).json({
        message: "Product not created",
      });
    }

    return res.status(200).json({
      message: "Product created successfully",
      data: product,
    });
  } catch (ex) {
    console.log(ex);
    return res.status(500).json({
      message: ex.message,
    });
    s;
  }
};

export const GetAllProduct = async (req, res) => {
  try {
    const product = await productModel.find().populate("category_id").lean();
    if (!product) {
      return res.status(400).json({
        message: "Product not found",
      });
    }
    return res.status(200).json({
      message: "Product found successfully",
      data: await attachReviewSummary(product),
    });
  } catch (ex) {
    console.log(ex);
    return res.status(500).json({
      message: ex.message,
    });
  }
};

export const SearchProducts = async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100);
    const filter = {};

    if (q) {
      const regex = new RegExp(escapeRegex(q), "i");
      filter.$or = [
        { name: regex },
        { brand: regex },
        { producthightlight: regex },
        { description: regex },
      ];
    }
    if (req.query.categoryId) filter.category_id = req.query.categoryId;
    if (req.query.brand) filter.brand = new RegExp(`^${escapeRegex(req.query.brand)}$`, "i");
    if (req.query.inStock === "true") filter.stock = { ...(filter.stock || {}), $gt: 0 };
    if (req.query.minPrice || req.query.maxPrice) {
      filter.price = {};
      if (req.query.minPrice) filter.price.$gte = Number(req.query.minPrice);
      if (req.query.maxPrice) filter.price.$lte = Number(req.query.maxPrice);
    }

    const sortMode = String(req.query.sort || "relevance");
    const sort =
      sortMode === "newest"
        ? { createdAt: -1 }
        : sortMode === "price_asc"
          ? { price: 1 }
          : sortMode === "price_desc"
            ? { price: -1 }
            : sortMode === "popularity"
              ? { viewCount: -1, createdAt: -1 }
              : { bestseller: -1, viewCount: -1, createdAt: -1 };

    let [products, total] = await Promise.all([
      productModel
        .find(filter)
        .populate("category_id")
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      productModel.countDocuments(filter),
    ]);

    let usedFuzzy = false;
    if (q && products.length < 3) {
      const candidates = await productModel
        .find({})
        .populate("category_id")
        .sort({ viewCount: -1, createdAt: -1 })
        .limit(300)
        .lean();
      const fuzzyMatches = candidates
        .map((product) => ({ product, score: fuzzyScore(q, product) }))
        .filter(({ score }) => score <= 2)
        .sort((a, b) => a.score - b.score || (b.product.viewCount || 0) - (a.product.viewCount || 0))
        .map(({ product }) => product);
      if (fuzzyMatches.length > products.length) {
        products = fuzzyMatches.slice((page - 1) * limit, page * limit);
        total = fuzzyMatches.length;
        usedFuzzy = true;
      }
    }

    let data = await attachReviewSummary(products);
    const minRating = Number(req.query.minRating);
    if (Number.isFinite(minRating) && minRating > 0) {
      data = data.filter((product) => Number(product.rating || 0) >= minRating);
    }

    await trackSearch({ req, query: q, resultCount: data.length, source: "search_page" });

    return res.status(200).json({
      success: true,
      data,
      meta: {
        query: q,
        usedFuzzy,
      },
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const AutocompleteProducts = async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) {
      return res.status(200).json({ success: true, data: [] });
    }

    const regex = new RegExp(escapeRegex(q), "i");
    let products = await productModel
      .find({ $or: [{ name: regex }, { brand: regex }] })
      .select("name brand image price stock")
      .sort({ viewCount: -1, createdAt: -1 })
      .limit(10)
      .lean();

    let usedFuzzy = false;
    if (products.length < 4) {
      const candidates = await productModel
        .find({})
        .select("name brand image price stock viewCount createdAt")
        .sort({ viewCount: -1, createdAt: -1 })
        .limit(200)
        .lean();
      const fuzzyMatches = candidates
        .map((product) => ({ product, score: fuzzyScore(q, product) }))
        .filter(({ score }) => score <= 2)
        .sort((a, b) => a.score - b.score || (b.product.viewCount || 0) - (a.product.viewCount || 0))
        .map(({ product }) => product);
      if (fuzzyMatches.length > products.length) {
        products = fuzzyMatches.slice(0, 10);
        usedFuzzy = true;
      }
    }

    await trackSearch({ req, query: q, resultCount: products.length, source: "autocomplete" });

    return res.status(200).json({
      success: true,
      meta: { query: q, usedFuzzy },
      data: products.map((product) => ({
        id: product._id,
        name: product.name,
        brand: product.brand,
        image: product.image,
        price: product.price,
        inStock: product.stock > 0,
      })),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const TrackSearchClick = async (req, res) => {
  try {
    const query = String(req.body?.query || "").trim();
    const productId = req.body?.productId;
    if (!query || !productId) {
      return res.status(400).json({
        success: false,
        message: "query and productId are required",
      });
    }

    await trackSearch({
      req,
      query,
      resultCount: 1,
      source: "suggestion_click",
      clickedProduct: productId,
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const GetProductById = async (req, res) => {
  try {
    const product = await productModel
      .findById(req.params.id)
      .populate("category_id")
      .lean();
    if (!product) {
      return res.status(400).json({
        message: "Product not found",
      });
    }

    product.viewCount = (product.viewCount || 0) + 1;
    await productModel.updateOne(
      { _id: req.params.id },
      { $inc: { viewCount: 1 } },
    );
    return res.status(200).json({
      message: "Product found successfully",
      data: await attachReviewSummary(product),
    });
  } catch (ex) {
    console.log(ex);
    return res.status(500).json({
      message: ex.message,
    });
  }
};

export const GetProductsByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const products = await Product.find({ category_id: categoryId })
      .populate("category_id")
      .lean();
    const enrichedProducts = await attachReviewSummary(products);

    return res.status(200).json({
      success: true,
      count: enrichedProducts.length,
      products: enrichedProducts,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const GetDeliveryEstimate = async (req, res) => {
  try {
    const pincode = String(req.query.pincode || "").trim();

    if (!/^[1-9][0-9]{5}$/.test(pincode)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid 6-digit Indian PIN code",
      });
    }

    const product = await Product.findById(req.params.id).select("stock");
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    if (product.stock <= 0) {
      return res.status(409).json({
        success: false,
        serviceable: false,
        message: "This product is currently out of stock",
      });
    }

    const { minDays, maxDays } = getDeliveryRange(pincode);
    const now = new Date();

    return res.status(200).json({
      success: true,
      serviceable: true,
      data: {
        pincode,
        minDays,
        maxDays,
        earliestDate: addDeliveryDays(now, minDays).toISOString(),
        latestDate: addDeliveryDays(now, maxDays).toISOString(),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// delete

export const DeleteProduct = async (req, res) => {
  try {
    const product = await productModel.findByIdAndDelete(req.params.id);
    if (!product) {
      return res.status(400).json({
        message: "Product not found",
      });
    }

    await deleteImageAsset(product.public_id);

    return res.status(200).json({
      message: "Product deleted successfully",
      data: product,
    });
  } catch (ex) {
    console.log(ex);
    return res.status(500).json({
      message: ex.message,
    });
  }
};

// update
export const UpdateProduct = async (req, res) => {
  try {
    const {
      name,
      description,
      price,
      mrp,
      category_id,
      size,
      brand,
      stock,
      producthightlight,
      bestseller,
      styles,
      variants,
      metaTitle,
      metaDescription,
      metaKeywords,
      slug,
    } = req.body;

    const product = await productModel.findById(req.params.id);
    if (!product) {
      return res.status(400).json({
        message: "Product not found",
      });
    }

    if (req.file) {
      const imageResult = await saveImageAsset({
        file: req.file,
        folder: "products",
        name: name || product.name,
        width: 500,
        height: 500,
        quality: 80,
      });

      await deleteImageAsset(product.public_id);

      product.image = imageResult.image;
      product.public_id = imageResult.public_id;
    }

    if (name !== undefined) product.name = name;
    if (size !== undefined) product.size = size;
    if (brand !== undefined) product.brand = brand;
    if (producthightlight !== undefined) product.producthightlight = producthightlight;
    if (styles !== undefined) product.styles = normalizeProductStyles(styles);
    if (variants !== undefined) product.variants = normalizeVariants(variants) || [];
    if (description !== undefined) product.description = description;

    // Only assigns keys the request actually sent, so an update that omits the
    // SEO block leaves existing metadata alone. `slug` is passed explicitly so
    // renaming a product does not silently rewrite a hand-picked slug.
    Object.assign(
      product,
      buildSeoFields({ metaTitle, metaDescription, metaKeywords, slug }),
    );

    if (price !== undefined && price !== "") {
      const nextPrice = Number(price);
      if (!Number.isFinite(nextPrice) || nextPrice < 0) {
        return res.status(400).json({ message: "Price cannot be negative" });
      }
      product.price = nextPrice;
    }
    if (mrp !== undefined && mrp !== "") {
      const nextMrp = Number(mrp);
      if (!Number.isFinite(nextMrp) || nextMrp < 0) {
        return res.status(400).json({ message: "MRP cannot be negative" });
      }
      product.mrp = nextMrp;
    }
    if ((product.mrp === undefined || product.mrp === null) && product.price !== undefined) {
      product.mrp = product.price;
    }
    if (category_id !== undefined && category_id !== "") product.category_id = category_id;
    if (stock !== undefined && stock !== "") {
      const nextStock = Number(stock);
      if (!Number.isInteger(nextStock) || nextStock < 0) {
        return res.status(400).json({
          message: "Stock must be a non-negative whole number",
        });
      }
      product.stock = nextStock;
    }
    if (bestseller !== undefined) product.bestseller = toBoolean(bestseller);
    await product.save();
    return res.status(200).json({
      message: "Product updated successfully",
      data: product,
    });
  } catch (ex) {
    console.log(ex);
    return res.status(500).json({
      message: ex.message,
    });
  }
};
