export const config = {
    PORT: process.env.PORT || 3000,
    CORS_ORIGIN: process.env.CORS_ORIGIN || "",
    TARGET_HOSTS: process.env.TARGET_HOSTS || "",
    RESPONSE: process.env.RESPONSE || "200",
    RETURNS_SUCCESS_FIRST: (process.env.RETURNS_SUCCESS_FIRST || "false").toLowerCase() === "true",
    FORWARDED_HEADER: process.env.FORWARDED_HEADER || ""
}
