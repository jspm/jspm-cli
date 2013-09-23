
import $ from 'jquery';

class veryLongClassName {
  constructor() {
    $(document.body).css('background-color', 'grey');
  }
}

setTimeout(function() {
  new veryLongClassName();
}, 3000);