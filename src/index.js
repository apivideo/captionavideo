require('dotenv').config();
//import express from 'express';
const express = require('express');
//express for the website and pug to create the pages
const app = express();
bodyParser = require('body-parser');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine','pug');
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
var request = require("request");


var fs = require('fs');



//apivideo
const apiVideo = require('@api.video/nodejs-sdk');


//if you chnage the key to sandbox or prod - make sure you fix the delegated toekn on the upload page
const apiVideoKey = process.env.apiProductionKey;
const authotKey = process.env.authotKey;
// website demo
//get request is the initial request - load the HTML page with the form
app.get('/', (req, res) => {
		res.sendFile(path.join(__dirname, '../public', 'index.html'));  
});



app.post('/createVideo', (req,res) => {
	console.log("request body",req.body);
	//now we'll make 2 rewquests to apivideo
	//1 create a videoId for the uppload, with any desired params
	//2 create a delegated token for the upload
	
	var title = req.body.title;
	var descr = req.body.description;
	var tags = req.body.tags;
	client = new apiVideo.Client({ apiKey: apiVideoKey});	
	
	
	let result = client.videos.create(title, {	"title": title,
		"description": descr,
		"tags":tags					
	});
	console.log(result);
	result.then(function(video) {
		console.log(video);
		var videoId = video.videoId;
		console.log(videoId);
		//ok have a new videoId for the video - now create a delegated token
		//since the new delegated token with TTL is not yet in the Node SDK, I'll have to authenticate 
		//and then request a token - 2 calls to api.video
		var authOptions = {
			method: 'POST',
			url: 'https://ws.api.video/auth/api-key',
			headers: {
				accept: 'application/json'
				
			},
			json: {"apiKey":apiVideoKey}

		}
		console.log(authOptions);	
		request(authOptions, function (error, response, body) {
			if (error) throw new Error(error);
			//this will give me the api key
			
			var authToken = body.access_token;
			console.log(authToken);
			//now use this to generate a delegated toke with a ttl of 90s
			var tokenTTL = 90;
			var tokenOptions = {
				method: 'POST',
				url: 'https://ws.api.video/upload-tokens',
				headers: {
					accept: 'application/json',
					authorization: 'Bearer ' +authToken
				},
				json: {"ttl":tokenTTL}
	
			}
			request(tokenOptions, function (error, response, body) {
				if (error) throw new Error(error);
				var delegatedToken = body.token;
				var tokenExpiry = body.expiresAt;
				console.log("new token", delegatedToken);
				console.log("new token expires", tokenExpiry);
				var tokenVideoIdJson = {"token": delegatedToken,
										"expires":tokenExpiry,
										"videoId": videoId};
				res.setHeader('Content-Type', 'application/json');
				res.end(JSON.stringify(tokenVideoIdJson));

			});


			
	 	   
		});	

		
	}).catch((error) => {
		console.log(error);
	});	




});

app.post('/checkmp4', (req,res) => {
	let videoId=req.body.videoId;
	let edit = req.body.editTranscript;
	console.log("videoid abd transcribing chekbox", videoId+edit);
	client = new apiVideo.Client({ apiKey: apiVideoKey});
	function checkPlayable(videoId) {
		console.log("checking mp4 encoding status");
		let status = client.videos.getStatus(videoId);
		status.then(function(videoStats){
		 // console.log(videoStats);
		  let playable = videoStats.encoding.playable;
		  let qualitylist = videoStats.encoding.qualities;
		  console.log("is video playable?", playable);
		  //only look for the mp4 if the video is playable
		  //when still encoding, sometimes the mp4 status does not appear immediately
		  if(playable){
			 console.log("video is playable");
			//video is ready 0 but now we need the mp4 url
			let getmp4Url = client.videos.get(videoId);
			getmp4Url.then(function(video) {
				console.log(video);
				mp4 = video.assets.mp4;
				console.log("got the mp4url", mp4);

				//send the mp4 to authot for transcription
				//submit the video to authot
				
				var authotSettings = {
					method: 'POST',
					url: 'https://app.xn--autht-9ta.com/api/sounds/new?lang=en-GB',
					headers: {
						'Access-Token': authotKey
						
					},
					json: {"data":mp4}
		
				}
				console.log("authotSettings", authotSettings);	
				request(authotSettings, function (error, response, body) {
					if (error) throw new Error(error);
					//this will give me the authot Id
					console.log("authot response",body);
					var authotId = body.id;
					console.log("video submitted to authot, ID is:", authotId);
					//now we have submitted the job to authot, we can ping every x seconds until it is ready.

					//when it is ready we'll graba  webVTT version
					//then uploadt teh webVTT version to api.video.
					function checkCaptionStatus(authotId){
						var authotSettings1 = {
							//method: 'POST',
								url: 'https://app.xn--autht-9ta.com/api/sounds/' +authotId,
								headers: {
									'Access-Token': authotKey
								}
							}
						request(authotSettings1, function (error, response, body1) {
							if (error) throw new Error(error);
							//response for status is not JSON.
							body1=JSON.parse(body1);
							var captioningStatus = body1.state;
							//mconsole.log("status check body:" ,body1);
							console.log("captioning status: ", captioningStatus);
							if(captioningStatus ==10){
								console.log("captioning complete, now requesting the webVTT file");
								//now the transcription is finished
								//request the webVTT file
								var authotSettings2 = {
									//method: 'POST',
										url: 'https://app.xn--autht-9ta.com/api/sounds/' +authotId+'?export_format=webvtt',
										headers: {
											'Access-Token': authotKey
										}
									}
								request(authotSettings2, function(error, response, body2){
									if (error) throw new Error(error);
									//this should get me the webvtt
									var webVTT = body2;
									console.log("Here is the webVTT: ", body2);
									//write the vtt
									var vttFilename = videoId + '.txt';
									fs.appendFile(vttFilename, webVTT, function (err) {
										if (err) throw err;
										console.log('caption saved!');
										//send to apivideo
										
										//but. there is a small bug - if a certain version of the HLS is not encoded, and we attach the VTT
										// the vtt will not be attached wben the HLS version is encoded.
										//so if 240, 360 480 are ready, they will have captions
										//but if 720p and 1080 and 2160 ar enot - and are finished later.. no captions
										// when this is fixed, we can pull the encoding function 
										// and uncomment the stuff below
										function allEncoded(vttFilename, videoId){
											var ready = true;
											console.log("checking encoding");
											let  encodeCheck = client.videos.getStatus(videoId);
											encodeCheck.then(function(encodingStatus){
												var qualities = encodingStatus.encoding.qualities;

												for(var i=0;i<qualities.length;i++){
													console.log("encoding: " +i + " "+qualities[i].status);
													if(qualities[i].status !=="encoded"){
														ready=false;
													}
												}
												//if ready is true - then we can end this
												//add the caption and be done with it
												if(ready){
													let caption  = client.captions.upload(vttFilename, {videoId: videoId, language: 'en'}); 
													caption.then(function(captionResult) {
														console.log(captionResult.src);
														console.log("caption added!!!");
														//delete caption file
														fs.unlink(vttFilename, function (err) {
															if (err) throw err;
															console.log('caption file deleted!');
														});
													});
													//send result to the webpage:
													res.sendStatus(200);
												}else{
													//not done encoding...
													//groundhog day
													
													setTimeout(allEncoded,2000,vttFilename, videoId);
												}



											}).catch((error) => {
												console.log(error);
											});	


										}
										allEncoded(vttFilename, videoId);
										/*
										let caption  = client.captions.upload(vttFilename, {videoId: videoId, language: 'en'}); 
										caption.then(function(captionResult) {
											console.log(captionResult.src);
											console.log("caption added!!!");
											//delete caption file
											fs.unlink(vttFilename, function (err) {
												if (err) throw err;
												console.log('caption file deleted!');
											  });
									  	});
										//send result to the webpage:
										res.sendStatus(200);
										*/
									  });


									

								});

								

							}else{
								//if the caption is not ready yet - wait 2 seconds and ask again.
								setTimeout(checkCaptionStatus,2000,authotId);
							}
						});
					}
					checkCaptionStatus(authotId);
				});
			}).catch((error) => {
				console.log(error);
			});

		  }else{
			  setTimeout(checkPlayable,2000,videoId);
		  }
	  }).catch((error) => {
			console.log(error);
		});	
	}
	checkPlayable(videoId);

});
app.post('/', (req, res) => {
	console.log(req.body);
	//console.log(req);
	//get values from POST body
	let videoId=req.body.videoId;
	let videoName = req.body.videoName;
	let videoDesc = req.body.videoDesc;
	let discordChannel = req.body.channel;
	let tag = "Discord";
	

	

	client = new apiVideo.Client({ apiKey: apiVideoKey});
	
	

	let result = client.videos.update(videoId, {	title: videoName, 
													description: videoDesc,					
													tags: [tag]
											});
											console.log(result);
	result.then(function(video) {
		console.log("video uploaded and renamed");
		//video name changed.  
		//now send it to discord
		//
		console.log(video);
		var playerUrl = video.assets.player;

		//we now have updated the video, and have the url - butu let's wait until the video is playeble before posting on discord (so the oembed works properly.)
		function checkPlayable(videoId) {
			console.log("checking mp4 encoding status");
			let status = client.videos.getStatus(videoId);
			status.then(function(videoStats){
			 // console.log(videoStats);
			  let playable = videoStats.encoding.playable;
			  let qualitylist = videoStats.encoding.qualities;
			  console.log("is video playable?", playable);
			  //only look for the mp4 if the video is playable
			  //when still encoding, sometimes the mp4 status does not appear immediately
			  if(playable){
				 console.log("video is playable");
				//send to discord
				//send 200 back to page
				var channel = discordClient.channels.cache.get(discordChannel);
				channel.send( videoDesc + playerUrl);
				res.sendStatus(200);

			  }else{
				  setTimeout(checkPlayable,2000,videoId);
			  }
		  }).catch((error) => {
				console.log(error);
			});	
		}
		checkPlayable(videoId);



	}).catch((error) => {
	    console.log(error);
	});
	
	

});


//testing on 3021
app.listen(process.env.PORT ||  3025, () =>
  console.log('Example app listening on port 3025!'),
);
process.on('uncaughtException', function(err) {
    // handle the error safely
    console.log(err)
    // Note: after client disconnect, the subprocess will cause an Error EPIPE, which can only be caught this way.
});



	