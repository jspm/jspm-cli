exports['voxel demo'] = function(done) {
  System.import('voxel-demo').then(function() {
    done();
  }).
  catch(function(e) {
    setTimeout(function() {
      throw e;
    });
  });
}