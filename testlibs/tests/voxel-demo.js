export function voxel_demo(done) {
  System.import('voxel-demo').then(function() {
    done();
  }).
  catch(function(e) {
    setTimeout(function() {
      throw e;
    });
  });
}