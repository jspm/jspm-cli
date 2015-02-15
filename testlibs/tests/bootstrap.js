import $ from 'bootstrap';
import 'bootstrap/css/bootstrap.css!';
import template from './bootstrap.html!text';

export function modal_test(done) {
  $("#sandbox").html(template);
  $('#myModal').on('shown.bs.modal', function() {
    done();
  });
  $('#sandbox .btn').click();
  done();
}