import banner from "rollup-plugin-banner";

export default {
  input: "./app.js",
  plugins: [
    banner.default("Running rolup with a wrapper around with jspm cli"),
  ],
  output: {
    file: "./build.js",
  },
};
