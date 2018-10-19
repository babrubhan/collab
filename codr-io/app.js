
// Include 3rd party node libraries.
var oOS                 = require('os');
var oPath               = require('path');
var oFS                 = require('fs');
var oUrl                = require('url');
var oExpress            = require('express');
var oWS                 = require('ws');
var oHTTP               = require('http');
var oLessMiddleware     = require('less-middleware');

// Setup global config parameters.
require('./config');
var sPublicDir = (g_oConfig.bIsProd ? './public_build' : './public');

// Import helpers.
var oHelpers     = require('./helpers-node');
var Client       = require('./client');
var EditSession  = require('./edit-session');
var Document     = require('./document');
var oDatabase    = require('./database');

// Error handling. // TODO: This is a horrible hack.
if (g_oConfig.bIsProd)
{
    process.on('uncaughtException', function (err)
    {
        console.error(err); // Keep node from exiting.
    });
}

// Create express app.
var oApp = oExpress();
oApp.configure(function()
{
    oApp.set('port', g_oConfig.iPort);

    // AldenD: Josiah added to support forking.
    // See http://expressjs.com/api.html
    oApp.use(oExpress.bodyParser());

    // Configure LESS compilation in dev.
    if (!g_oConfig.bIsProd)
    {
        // Configure LESS middleware.
        // Create empty codr_less_output directory.
        var sLessOutputDir = oPath.join(oOS.tmpdir(), 'codr_less_output');
        if (oFS.existsSync(sLessOutputDir))
            oHelpers.emptyDirSync(sLessOutputDir);
        else
            oFS.mkdirSync(sLessOutputDir);
            
        oApp.use(oLessMiddleware(
        {
            src: sPublicDir,
            dest: sLessOutputDir
        }));
        oApp.use(oExpress.static(sLessOutputDir));
    }
    
    // Serve with gzip headers in production.
    // The build script should gzip all static files.
    if (g_oConfig.bIsProd)
    {
        oApp.use(function(req, res, next)
        {
            if (req.url.indexOf('/ajax/') == -1)
                res.set("Content-Encoding", "gzip");
            next();
        });        
    }
    
    // Serve static content.
    oApp.use(oExpress.static(sPublicDir));        

    // Serve tests.
    oApp.get('^/tests/?$', function(req, res) { res.sendfile(sPublicDir + '/tests.html'); });

    // Ajax entrypoint to load document. Used by snapshots since
    // snapshots don't have a websocket connection to the server.
    oApp.get('^/ajax/:DocumentID([a-z0-9]+)/?$', function(req, res) {

        function send(oDocument)
        {
            res.set('Content-Type', 'text/json');
            
            if (oDocument.get('bIsSnapshot'))
            {
                res.send(oDocument.toJSON());
            }
            else
            {
                var sError = 'The document has not been published. Please click <a href="/' + sDocumentID + '/">here</a> to see the original.';
                res.send(oHelpers.toJSON({'sError': sError}));
            }
        }
        
        var sDocumentID = req.params['DocumentID'];
        //console.log(sDocumentID);
        if (sDocumentID in g_oEditSessions)
        {
            send(g_oEditSessions[sDocumentID].getDocument());
        }
        else
        {
            oDatabase.getDocument(sDocumentID, this, function(sDocumentJSON)
            {
                send(new Document(sDocumentJSON));
            });
        }
    });
    
    oApp.post('^/fork/?$', function(req, res)
    {
        function _fork(oDocument)
        {
            var sClone = oDocument.clone().toJSON();
            oDatabase.createDocument(sClone, this, function(sID)
            {
                res.redirect('/' + sID);
            });
        }

        var sDocumentID = req.body.documentID;
        if (sDocumentID in g_oEditSessions)
        {
            _fork(g_oEditSessions[sDocumentID].getDocument())
        }
        else
        {
            oDatabase.getDocument(sDocumentID, this, function(sDocumentJSON)
            {
                var oDocument = new Document(sDocumentJSON);
                _fork(oDocument);
            });
        }
    });

    oApp.get('^/[a-z0-9]+/?$',          function(req, res) { res.sendfile(sPublicDir + '/index.html'); });
    oApp.get('^/v/[a-z0-9]+/?$',        function(req, res) { res.sendfile(sPublicDir + '/index.html'); });

    /* Preview files as HTML. */
    oApp.get(':ignore(/v)?/:DocumentID([a-z0-9]+)/preview/?$', function(req, res)
    {
        res.sendfile(sPublicDir + '/preview.html');
    });

    /* Download file */
    oApp.get(':ignore(/v)?/:DocumentID([a-z0-9]+)/download/?$', function(req, res)
    {
        // Parse the url and get/sanatize the file name.
        var sFileName = oUrl.parse(req.url, true).query.filename;
        sFileName = sFileName.replace(/[^a-z0-9_\.\- ]/gi, '');
        
        // Set response headers for file download.
        // Default to plain text in case there is no file name.
        res.set("Content-Encoding", "none");
        res.set('Content-Type', 'text/plain');
        
        // Content-Type is automatically determined if there is a file name.
        res.attachment(sFileName);
        
        // Send document text.
        var oDocument = null;
        var sDocumentID = req.params['DocumentID'];
        if (sDocumentID in g_oEditSessions)
        {
            oDocument = g_oEditSessions[sDocumentID].getDocument();
            //console.log(oDocument);
            // TODO: Determine correct line-ending client-side.
            res.send(oDocument.get('aLines').join('\r\n'));
        }
        else
        {
            oDatabase.getDocument(sDocumentID, this, function(sDocumentJSON)
            {
                // TODO: Determine correct line-ending client-side.
                res.send((new Document(sDocumentJSON)).get('aLines').join('\r\n'));
            });
        }
    });
});

var uStatusState;
var isCompiled = false;  

/* compiling file*/    
  oApp.post('/compilecode' , function (req , res ) {
     
      isCompiled = false;
      uStatusState = "Compiling";
      
      var oDocument;
      var code;
      var sDocumentID = req.body.docID;

      if (sDocumentID in g_oEditSessions) {
          oDocument = g_oEditSessions[sDocumentID].getDocument();
          code = oDocument.get('aLines').join('\r\n');
      };

      cFilepath = './temp/' + sDocumentID + '/';                            //Source code directory file path

      oFS.exists( cFilepath, function(exists){                              //Creating the temp folder for storing the client files if it doesn't exists
          if(!exists)
          {
              console.log('INFO: ' + sDocumentID + ' directory created for storing temporary sourceCode I/O files.' );
              oFS.mkdirSync(cFilepath);
          }
          
          oFS.writeFile(cFilepath + 'sourceCode.c', code, function(err) {        //creating the seperate folder for each client by using the client-id
              if(err){
                  res.send({
                        compilerState: 'bab(1): ' + JSON.stringify(err),
                        uStatusState
                      });
                }
	      else {
              //Docker conatiner
                  var Docker = require('dockerode');
                  var stream = require('stream');
                  var docker = new Docker({socketPath: '/var/run/docker.sock'});
                  
                  var dPaths = { bind: ['/root/working_project/Collab_TD/codr-io:/src']
                               };
                               
                  var dImage = 'gccbox';           
                  var codeFile = '/src/temp/' + sDocumentID + '/sourceCode.c';
                  var outputFile = '/src/temp/' + sDocumentID + '/sourceCode';
                  
                  var dCommands = { compile: ['gcc', codeFile, '-o', outputFile],
                                    run : [outputFile],
                                    debug: ['ls','-l','/src/temp/'+sDocumentID],            
                                  };                                
                  docker.run(dImage, dCommands.compile, process.stdout, {
                    'Volumes': {
                      '/src': {}
                      },
                    'Hostconfig': {
                    'Binds': dPaths.bind,
                      }
                      }, function (err, data, container) {
                          if (err) {
                              res.send({
                                  compilerState: 'bab(0): ' + SON.stringify(err),
                                  uStatusState
                                });
                            } 
                          else {
					container.inspect(function (err, data) {
					  oFS.readFile(data.LogPath, 'utf8', function(err,data){                //reading log file(JSON) for the output,
					  var strLines = data.split("\n");
					  var strData = []
					  for(var i=0; i<strLines.length-1; i++) {
					  	var obj = JSON.parse(strLines[i]);
					    	strData[i] = obj.log;
					  }
					  if(strData == "") {
						compilerState = 'Compilation OK';
					   }
					  else {	
						compilerState = strData; 
					   }

					res.send({
                                                compilerState,
                                                uStatusState
						});

					   });
					});
                           	 }

                      });
	 	  }
              });
          });
    });

 /* Running file */
  oApp.post('/runcode' , function (req , res ) {
  
      uStatusState = "Running";
 
      var oDocument;
      var code;
      var sDocumentID = req.body.docID;

      if (sDocumentID in g_oEditSessions) {
          oDocument = g_oEditSessions[sDocumentID].getDocument();
          code = oDocument.get('aLines').join('\r\n');
      };

      cFilepath = './temp/' + sDocumentID + '/';                            //Source code directory file path

      oFS.exists( cFilepath, function(exists){                              //Creating the temp folder for storing the client files if it doesn't exists
          if(!exists)
          {
              console.log('INFO: ' + sDocumentID + ' directory created for storing temporary sourceCode I/O files.' );
              oFS.mkdirSync(cFilepath);
          }
          
          oFS.writeFile(cFilepath + 'sourceCode.c', code, function(err) {        //creating the seperate folder for each client by using the client-id
              if(err){
                  res.send({
                      compilerState: JSON.stringify(err),
                      uStatusState
                      });
                  }
              //Docker conatiner
                  var Docker = require('dockerode');
                  var stream = require('stream');
                  var docker = new Docker({socketPath: '/var/run/docker.sock'});
                  
                  var dPaths = { bind: ['/root/working_project/Collab_TD/codr-io:/src']
                               };
                               
                  var dImage = 'gccbox';           
                  var codeFile = '/src/temp/' + sDocumentID + '/sourceCode.c';
                  var outputFile = '/src/temp/' + sDocumentID + '/sourceCode';
                  
                  var dCommands = { compile: ['gcc', codeFile, '-o', outputFile],
                                    run : [outputFile],
                                    debug: ['ls','-l','/src/temp/'+sDocumentID],            
                                  };              
                   //compile command               
                  docker.run(dImage, dCommands.compile, process.stdout, {
                    'Volumes': {
                      '/src': {}
                      },
                    'Hostconfig': {
                    'Binds': dPaths.bind,
                      }
                      }, function (err, data, container) {
                          if (err) {
                              res.send({
                                  compilerState: JSON.stringify(err),
                                  uStatusState
                                });
                              } 
                          else {
                                //Run command
                                docker.run('gccbox', dCommands.run, process.stdout, {
                                'Volumes': {
                                '/src': {}
                                  },
                                'Hostconfig': {
                                'Binds': dPaths.bind,
                                  }
                                  }, function (err, data, container) {
                                      if (err) {
                                          res.send({
                                              compilerState: JSON.stringify(err),
                                              uStatusState
                                            });
                                        }
                                      else {
                                          container.inspect(function (err, data) {
                                          oFS.readFile(data.LogPath, 'utf8', function(err,data){                //reading log file(JSON) for the output, 
                                            if(err){                                                              //another way to do this is by using docker stream
                                              res.send({
                                                  compilerState: JSON.stringify(err),
                                                  uStatusState
                                                });
                                              }
                                            var objJSON = JSON.parse(data);
                                            var dResult = objJSON.log;
                                         
                                            res.send({
                                                compilerState: dResult,
                                                uStatusState
                                              });
                                         // res.send(dResult);              //JSON.stringify                      //server response to the client side
                                         
                                          });
                                        });
                                      }
					//container.remove(function (err, data) {
  					//console.log(data);
					//});				
	
                                  });
                               }
                        });                         
                    });
          });
      });

// Instantiate server.
var oServer = oHTTP.createServer(oApp);
oServer.listen(oApp.get('port'), function()
{
    console.log("Express server listening on port " + oApp.get('port'));
});

// Instantiate websocket listener.
var oWsServer = new oWS.Server({server: oServer});
oWsServer.on('connection', function(oSocket)
{
    new Client(oSocket, '');
});
