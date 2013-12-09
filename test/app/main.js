import $ from 'jquery';
import test from './main-dep';

var veryLongFunctionName = function() {
  $(document.body).html('test');
}

setTimeout(function() {
  veryLongFunctionName();
  window.veryLongFunctionName = veryLongFunctionName;
}, 1000);
