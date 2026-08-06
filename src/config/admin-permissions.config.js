export const ADMIN_PERMISSIONS = {
  DASHBOARD_READ: "dashboard:read",
  USERS_MANAGE: "users:manage",
  PRODUCTS_MANAGE: "products:manage",
  CATEGORIES_MANAGE: "categories:manage",
  PRODUCTS_BULK: "products:bulk",
  INVENTORY_MANAGE: "inventory:manage",
  ORDERS_MANAGE: "orders:manage",
  REPORTS_READ: "reports:read",
  COUPONS_MANAGE: "coupons:manage",
  COUPONS_REPORTS: "coupons:reports",
  AUDIT_READ: "audit:read",
  CMS_MANAGE: "cms:manage",
  THEME_MANAGE: "theme:manage",
  BANNERS_MANAGE: "banners:manage",
  POLICIES_MANAGE: "policies:manage",
  RETURNS_MANAGE: "returns:manage",
  REVIEWS_MANAGE: "reviews:manage",
  CONTACT_MANAGE: "contact:manage",
  REFERRALS_MANAGE: "referrals:manage",
  ANALYTICS_READ: "analytics:read",
};

export const ADMIN_ROLES = [
  "admin",
  "superAdmin",
  "orderManager",
  "productManager",
  "salesManager",
  "themeEditor",
];

export const USER_ROLE = "user";

export const VALID_USER_ROLES = [USER_ROLE, ...ADMIN_ROLES];

export const ROLE_PERMISSIONS = {
  superAdmin: Object.values(ADMIN_PERMISSIONS),
  admin: Object.values(ADMIN_PERMISSIONS),
  orderManager: [
    ADMIN_PERMISSIONS.DASHBOARD_READ,
    ADMIN_PERMISSIONS.ORDERS_MANAGE,
    ADMIN_PERMISSIONS.RETURNS_MANAGE,
    ADMIN_PERMISSIONS.REPORTS_READ,
  ],
  productManager: [
    ADMIN_PERMISSIONS.DASHBOARD_READ,
    ADMIN_PERMISSIONS.PRODUCTS_MANAGE,
    ADMIN_PERMISSIONS.CATEGORIES_MANAGE,
    ADMIN_PERMISSIONS.PRODUCTS_BULK,
    ADMIN_PERMISSIONS.INVENTORY_MANAGE,
  ],
  salesManager: [
    ADMIN_PERMISSIONS.DASHBOARD_READ,
    ADMIN_PERMISSIONS.ORDERS_MANAGE,
    ADMIN_PERMISSIONS.RETURNS_MANAGE,
    ADMIN_PERMISSIONS.COUPONS_MANAGE,
    ADMIN_PERMISSIONS.COUPONS_REPORTS,
    ADMIN_PERMISSIONS.REPORTS_READ,
    ADMIN_PERMISSIONS.REFERRALS_MANAGE,
    ADMIN_PERMISSIONS.REVIEWS_MANAGE,
    ADMIN_PERMISSIONS.CONTACT_MANAGE,
    ADMIN_PERMISSIONS.ANALYTICS_READ,
  ],
  themeEditor: [
    ADMIN_PERMISSIONS.DASHBOARD_READ,
    ADMIN_PERMISSIONS.CMS_MANAGE,
    ADMIN_PERMISSIONS.THEME_MANAGE,
    ADMIN_PERMISSIONS.BANNERS_MANAGE,
    ADMIN_PERMISSIONS.POLICIES_MANAGE,
  ],
};

export const getRolePermissions = (role) => ROLE_PERMISSIONS[role] || [];

export const normalizeRoles = ({ role, roles } = {}) => {
  const values = [
    ...(Array.isArray(roles) ? roles : []),
    role,
  ]
    .filter(Boolean)
    .map((value) => String(value).trim())
    .filter((value) => VALID_USER_ROLES.includes(value));

  const unique = [...new Set(values)];
  return unique.length > 0 ? unique : [USER_ROLE];
};

export const getPrimaryRole = (user = {}) => {
  const roles = normalizeRoles(user);
  return roles.find((role) => ADMIN_ROLES.includes(role)) || roles[0] || USER_ROLE;
};

export const isAdminRole = (role) => ADMIN_ROLES.includes(role);

export const hasAdminRole = (user = {}) =>
  normalizeRoles(user).some((role) => ADMIN_ROLES.includes(role));

export const getRolesPermissions = (roles = []) => [
  ...new Set(roles.flatMap((role) => getRolePermissions(role))),
];

export const getUserPermissions = (user = {}) => [
  ...new Set([
    ...getRolesPermissions(normalizeRoles(user)),
    ...(Array.isArray(user.permissions) ? user.permissions : []),
  ]),
];
