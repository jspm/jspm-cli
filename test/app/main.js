import $ from 'jquery';

var veryLongFunctionName = function() {
  $(document.body).html('test');
}

setTimeout(function() {
  veryLongFunctionName();
  window.veryLongFunctionName = veryLongFunctionName;
}, 1000);