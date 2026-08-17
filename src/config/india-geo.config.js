// Single source of truth for India-specific address validation, so the
// checkout schema and the order-pricing service never drift apart again
// (they previously used two different pincode patterns).
export const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
];

// 10-digit mobile number, must start 6-9 (the actual range of mobile
// prefixes TRAI allocates in India — 0-5 are landline/other ranges).
export const INDIAN_MOBILE_REGEX = /^[6-9][0-9]{9}$/;

// 6-digit PIN code, first digit 1-9 (India Post never issues a PIN starting
// with 0).
export const INDIAN_PINCODE_REGEX = /^[1-9][0-9]{5}$/;
