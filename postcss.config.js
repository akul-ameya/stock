// postcss.config.js  (in your project root, next to package.json)
module.exports = {
  plugins: {
    // ← use the NEW PostCSS plugin
    '@tailwindcss/postcss': {},
    // ← autoprefixer stays the same
    autoprefixer: {},
  }
}
