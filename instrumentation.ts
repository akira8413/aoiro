export function register() {
  if (process.env.NODE_ENV === "production" && !process.env.APP_SECRET) {
    throw new Error("APP_SECRET is required in production");
  }
}
