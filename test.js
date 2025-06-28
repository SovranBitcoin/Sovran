const color = require('dominant-color');
color('./assets/images/backgrounds/bg7.png', function (err, color) {
  console.log(color); // '5b6c6e'
});
