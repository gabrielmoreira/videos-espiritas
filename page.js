var fs = require('fs'),
   videos = require('./db/videos.json');

var config = {
   duracaoMinima: 40 * 60, // 40 minutos
   duracaoMaxima: (60 + 20) * 60, // 1h e 20 minutos
   arquivo: './page/videos.js',
}

var count = videos.length;

videos = videos.filter(function(video) {
   return (video.duracao >= config.duracaoMinima
      && video.duracao <= config.duracaoMaxima);
}).sort(function(a, b) {
   return ((b.views || b.page_views) * 10000 + b.duracao)
   - ((a.views || a.page_views) * 10000 + a.duracao);
});

var js = "var Videos = " + JSON.stringify(videos, null, '\t') + ';';
fs.writeFileSync(config.arquivo, js);
console.log(`Arquivo ${config.arquivo} gerado com ${videos.length} de ${count}`);
