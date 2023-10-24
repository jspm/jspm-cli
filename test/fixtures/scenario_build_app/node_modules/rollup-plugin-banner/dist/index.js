"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = banner;

var _banner = _interopRequireDefault(require("./banner"));

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function banner() {
  var options = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
  var plugin = new _banner.default(options);
  return {
    name: 'banner',
    renderChunk: function renderChunk(code) {
      return plugin.prependBanner(code);
    }
  };
}