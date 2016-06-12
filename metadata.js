var Promise = require('bluebird');
var request = require('superagent');
var log = require('debug')('scrap');
var cheerio = require('cheerio');
var extend = require('extend');
var fs = Promise.promisifyAll(require('fs'));
var videoUrlNormalizer = require('video-url-normalizer');
var sanitize = require("sanitize-filename");
var ProgressBar = require('progress');
var requestGet = Promise.promisify(request.get.bind(request));

function getMetadata(url) {
   var path = __dirname + "/cache/metadata/" + sanitize(url);
   return fs.statAsync(path).then(function(stat) {
      return fs.readFileAsync(path);
   }).catch(function(e) {
      return requestGet(url).catch(function(e, res) {
         if (e.response.statusCode === 404) {
            return Promise.resolve({
               text: JSON.stringify({
                  status: e.response.statusCode,
                  body: e.response.text,
                  url: url
               })
            });
         }
         return Promise.reject(e);
      }).then(function(res) {
         return fs.writeFileAsync(path, res.text, 'utf8').then(function() {
            return res.text;
         });
      });
   });
}

function getPageFiles() {
   return Promise.resolve().then(function() {
      var path = __dirname + "/db/pages/";
      return fs.readdirSync(path).filter(function(file) {
         return /[0-9]{4}\.json/i.test(file);
      }).map(function(file) {
         return path + file;
      });
   });
}

function saveVideoJson(video) {
   var key = sanitize(video.id || video.normalized.url);
   var path = __dirname + "/db/videos/" + key + ".json";
   return fs.writeFileAsync(path, JSON.stringify(video, null, 2), 'utf8');
}

function getPages() {
   return Promise.map(getPageFiles(),
      function(file) {
         return fs.readFileAsync(file, {
            encoding: 'utf8'
         }).then(function(data) {
            return JSON.parse(data);
         });
      }, {
         concurrency: 2
      });
}

function parseYoutubeDuration(duration) {
   var a = duration.match(/\d+/g);
   if (duration.indexOf('M') >= 0 && duration.indexOf('H') == -1 && duration.indexOf('S') == -1) {
      a = [0, a[0], 0];
   }
   if (duration.indexOf('H') >= 0 && duration.indexOf('M') == -1) {
      a = [a[0], 0, a[1]];
   }
   if (duration.indexOf('H') >= 0 && duration.indexOf('M') == -1 && duration.indexOf('S') == -1) {
      a = [a[0], 0, 0];
   }
   duration = 0;
   if (a.length == 3) {
      duration = duration + parseInt(a[0]) * 3600;
      duration = duration + parseInt(a[1]) * 60;
      duration = duration + parseInt(a[2]);
   }

   if (a.length == 2) {
      duration = duration + parseInt(a[0]) * 60;
      duration = duration + parseInt(a[1]);
   }

   if (a.length == 1) {
      duration = duration + parseInt(a[0]);
   }
   return duration
}

function videoNormalizer(url, video) {
   if (/vimeo\.com/i.test(url)) {
      var data = {
         hoster: "vimeo",
         id: /([0-9]{5,})(?:[^0-9]|$)/.exec(url)[1],
         original: url
      };
      data.url = "http://www.vimeo.com/" + data.id;
      data.metadataUrl = "https://vimeo.com/api/oembed.json?url=" + encodeURIComponent(data.url);
      return data;
   } else if (/youtube(-nocookie)?\.com/i.test(url) || /youtu\.be/i.test(url)) {
      var data = {
         hoster: "youtube",
         id: /([a-zA-Z0-9\-_]{11})(?:[^a-zA-Z0-9-_]|$)/.exec(url)[1],
         original: url
      };
      if (data.id.toLowerCase() !== 'videoseries') {
         data.url = "https://www.youtube.com/watch?v=" + data.id;
         data.metadataUrl = "https://www.googleapis.com/youtube/v3/videos?part=contentDetails%2Csnippet&key=$YOUTUBE_API_KEY&id=" + data.id;
      }
      return data;
   } else if (/dailymotion\.com/i.test(url) || /dai\.ly/i.test(url)) {
      var data = {
         hoster: "dailymotion",
         id: /[^-_0-9a-zA-Z](x[-0-9a-zA-Z]{2,})(?:[_&?]|$)/.exec(url)[1],
         original: url
      };
      data.url = "http://www.dailymotion.com/video/" + data.id;
      data.metadataUrl = "https://api.dailymotion.com/video/" + data.id + "?fields=id,duration,description,title,thumbnail_url,views_total";
      return data;
   } else if (/video.globo.com/.test(url)) {
      var data = {
         hoster: "globo",
         id: /midiaId=([0-9]+)/.exec(video.flashvars)[1],
         original: url
      };
      data.url = "http://globotv.globo.com/rede-globo/mais-voce/v/x/" + data.id;
      return data;
   } else {
      return {
         url: url
      };
   }
}

function getVideoMetadata(url, video) {
   url = url.replace(/\$(\w+_API_KEY)/, function(ignore, key) {
      return process.env[key];
   });
   return getMetadata(url).then(function(metadata) {
      metadata = JSON.parse(metadata);
      video.tipo = (video.id || "desconhecido").split('-')[0];
      video.page_views = video.views;
      if (video.tipo === "youtube" && metadata && metadata.items && metadata.items.length) {
         var item = metadata.items[0];
         video.duracao = parseYoutubeDuration(item.contentDetails.duration);
      } else if (video.tipo === "vimeo") {
         video.duracao = metadata.duration;
      } else if (video.tipo === "dailymotion") {
         video.duracao = metadata.duration;
         video.views = metadata.views_total;
      }
      return video;
   })
}

function normalizeVideo(video) {
   return Promise.resolve().then(function() {
      var normalized = videoNormalizer(video.frameUrl, video);
      if (!normalized.id) {
         //console.log(normalized, video);
      }
      if (normalized.id && normalized.hoster)
         video.id = normalized.hoster + "-" + normalized.id;
      if (normalized.metadataUrl) {
         return getVideoMetadata(normalized.metadataUrl, video);
      }
      video.normalized = normalized;
      return video;
   }).catch(function(e) {
      console.error("=====> Video", video.frameUrl, "error", e);
      return Promise.reject(e);
   }).then(function(video) {
      saveVideoJson(video);
      return video;
   });
}

function normalizePage(page) {
   return Promise.map(page.videos,
      normalizeVideo, {
         concurrency: 5
      }).then(function(videos) {
      page.videos = videos;
      return page;
   });
}

function getNormalizedPages() {
   return getPages().then(function(pages) {
      var bar = new ProgressBar('Baixando página :current/:total (:pagina) [:bar] :percent :etas', {
         total: pages.length,
         width: 70
      });
      return Promise.map(pages, function(page) {
         return normalizePage(page).then(function(page) {
            var url = page.page;
            bar.tick({
               pagina: url.substring(url.length - 8)
            });
            return page;
         });
      }, {
         concurrency: 2
      });
   });
}

function getNormalizedVideos() {
   return getNormalizedPages().then(function(pages) {
      var videos = [];
      pages.forEach(function(page) {
         videos = videos.concat(page.videos);
      })
      return videos;
   })
}


getNormalizedVideos().then(function(videos) {
   return fs.writeFileAsync(__dirname + "/db/videos.json", JSON.stringify(videos, null, 2), 'utf8');
}).then(function() {
   console.log("fim");
});



//			normalized: videoUrlNormalizer(frame.trim()),
