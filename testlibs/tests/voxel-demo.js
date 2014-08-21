exports['voxel demo'] = function(done) {
  System.import('npm:voxel-demo').then(function() {
    done();
  }).
  catch(function(e) {
    setTimeout(function() {
      throw e;
    });
  });
}