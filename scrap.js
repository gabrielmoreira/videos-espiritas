var Promise = require('bluebird');
var request = require('superagent');
var log = require('debug')('scrap');
var cheerio = require('cheerio');
var extend = require('extend');
var fs = Promise.promisifyAll(require('fs'));
var sanitize = require("sanitize-filename");
var ProgressBar = require('progress');
var requestGet = Promise.promisify(request.get.bind(request));
log("starting scrapping");

function shuffle(array) {
   var counter = array.length,
      temp, index;
   // While there are elements in the array
   while (counter > 0) {
      // Pick a random index
      index = Math.floor(Math.random() * counter);
      // Decrease counter by 1
      counter--;
      // And swap the last element with it
      temp = array[counter];
      array[counter] = array[index];
      array[index] = temp;
   }
   return array;
}

function getPage(url) {
   var path = __dirname + "/cache/pages/" + sanitize(url);
   return fs.statAsync(path).then(function(stat) {
      return fs.readFileAsync(path);
   }).catch(function(e) {
      return requestGet(url).then(function(res) {
         return fs.writeFileAsync(path, res.text, 'utf8').then(function() {
            return res.text;
         });
      });
   });
}

function savePageJson(page) {
   var key = ("0000" + sanitize(page.page.replace(/.*?([0-9]+)$/g, "$1")));
   var path = __dirname + "/db/pages/" + key.substring(key.length - 4) + ".json";
   return fs.writeFileAsync(path, JSON.stringify(page, null, 2), 'utf8');
}

function getVideos($) {
   return $('.xg_list_video_main > ul >li').map(function() {
      var $video = $(this);
      return {
         page: $video.find('h3 a').attr('href').trim(),
         title: $video.find('h3').text().trim(),
         shortDescription: $video.find('.item_description').text().trim(),
         views: parseInt($video.find('.item_views').text().trim(), 10)
      };
   }).toArray();
}

function getLastPage($) {
   var paging = $('.pagination li:not(.right)').map(function() {
      return $(this).text();
   });
   return parseInt(paging[paging.length - 2], 10);
}

function scrapVideosPage(url) {
   return getPage(url).then(function(html) {
      var $ = cheerio.load(html);
      //log("Scrapping videos", url);
      return {
         page: url,
         //content: res.text,
         videos: getVideos($),
         lastPage: getLastPage($)
      };
   });
}

function scrapVideoPage(url) {
   return getPage(url).then(function(html) {
      var $ = cheerio.load(html);
      //log("Scrapping video page", url);
      var frame = $('.xg_module_body .vid_container  iframe').add($('.xg_module_body .vid_container  embed')).first().attr('src');
      if (!frame)
         frame = $('.xg_module_body .vid_container  object param[name="movie"]').attr('value');
      var flashvars = $('.xg_module_body .vid_container  embed').attr('flashvars');
      if (flashvars) flashvars = flashvars.trim();
      return {
         page: url,
         frameUrl: frame.trim(),
         flashvars: flashvars,
         description: $('.xg_user_generated .description').text().trim(),
      };
   }).catch(function(e) {
      log("Error on" + url, e);
      return Promise.reject(e);
   });
}


function scrapDepthVideosPage(url) {
   return scrapVideosPage(url).then(function(page) {
      return Promise.map(page.videos, function(video) {
         return scrapVideoPage(video.page).then(function(videoPage) {
            extend(true, video, videoPage);
            return video;
         })
      }, {
         concurrency: 4
      }).then(function() {
         return page;
      });
   });
}

function scrapAllVideos() {
   return scrapDepthVideosPage('http://www.redeamigoespirita.com.br/video?page=1').then(function(page) {
      savePageJson(page);
      var urls = [];
      for (var i = 2; i <= page.lastPage; i++) {
         urls.push('http://www.redeamigoespirita.com.br/video?page=' + i);
      };
      //shuffle(urls);
      var bar = new ProgressBar('Baixando página :current/:total (:pagina) [:bar] :percent :etas', {
         total: urls.length,
         width: 70
      });
      return Promise.map(urls, function(url) {
         return scrapDepthVideosPage(url).then(function(page) {
            //log("Saving page", page.page);
            savePageJson(page);
            bar.tick({
               pagina: url.substring(url.length - 8)
            });
            return page.videos;
         });
      }, {
         concurrency: 4
      });
   })
}

scrapAllVideos().then(function() {
   log("finished scrapping");
});
