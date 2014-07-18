var React = require('react');
var jQuery = require('jquery');

var Final = React.createClass({
    render: function() {
        return (
            React.DOM.div(null, 
                React.DOM.h1(null, "Final!")
            )
        );
    }
});

module.exports = Final;
