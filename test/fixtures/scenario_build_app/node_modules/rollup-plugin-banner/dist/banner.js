"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

var template = require('lodash.template');

var fs = require('fs');

var path = require('path');

var BannerPlugin =
/*#__PURE__*/
function () {
  function BannerPlugin() {
    var options = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

    _classCallCheck(this, BannerPlugin);

    this._options = options;
    this._cwd = options.cwd || process.cwd();
    this._pkg = require(path.join(this._cwd, 'package.json'));
  }

  _createClass(BannerPlugin, [{
    key: "prependBanner",
    value: function prependBanner(code) {
      var content = '';
      var res = code;

      if (typeof this._options === 'string') {
        content = this._options;
      } else {
        var _this$_options = this._options,
            file = _this$_options.file,
            encoding = _this$_options.encoding;
        if (!file) return code;
        var filePath = path.resolve(file);
        var exits = fs.existsSync(filePath);

        if (exits) {
          content = fs.readFileSync(filePath, encoding || 'utf-8');
        }
      } // fix content


      if (content) {
        var tmpl = template(content);
        var text = '';
        var arr = tmpl({
          pkg: this._pkg
        }).split('\n');

        if (arr.length === 1) {
          text = '// ' + arr[0] + '\n';
        } else {
          for (var i = 0; i < arr.length; i++) {
            var item = arr[i];

            if (i === 0) {
              text += '/**\n * ' + item + '\n';
            } else if (i === arr.length - 1) {
              text += ' * ' + item + '\n */\n\n';
            } else {
              text += ' * ' + item + '\n';
            }
          }
        }

        res = text + code;
      }

      return res;
    }
  }]);

  return BannerPlugin;
}();

exports.default = BannerPlugin;