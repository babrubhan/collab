var oHelpers     = require('./helpers-node');
var oOT          = require('./public/javascripts/OT');
var Client       = require('./client');
var Document     = require('./document');
var oDatabase    = require('./database');

module.exports = oHelpers.createClass(
{
    // Data
    _oDocument: null,
    _sDocumentID: '',

    // Loading state
    _bDocumentLoaded: false,
    
    // Audo save
    _iAutoSaveTimeoutID: null,
    _iAutoSaveTimeoutLength: 30, /* auto save every 30 seconds */
    
    _aClients: null,

    // PeoplePane
    _iGeneratedClientNames: 0,
    _aCurrentlyTyping: null,

    // OT
    _aPastDeltas: null, // Uses for OT transformation.
    _iServerState: 0,
    
    __init__: function(sDocumentID, oClient)
    {
        // Save to global map.
        g_oEditSessions[sDocumentID] = this;
        
        // Initialize members.
        this._sDocumentID = sDocumentID;
        this._aClients = [];
        this._aCurrentlyTyping = [];
        this._aDeltaHistory = [];
        
        // Add the intial client.
        this.addClient(oClient);
        
        // Open document.
        oDatabase.getDocument(sDocumentID, this, function(sDocumentJSON)
        {
            // Save pointer to document.
            this._oDocument = new Document(sDocumentJSON);
            this._bDocumentLoaded = true;
        
            if (this._oDocument.get('bIsSnapshot'))
            {
                var sErrorMessage = 'This document has been published and can not be edited.' +
                                    'To see the published version click <a href="/v/' + sDocumentID + '">here</a>.';
                for (var i = 0; i < this._aClients.length; i++)
                    this._aClients[i].abort(sErrorMessage);
                
                delete g_oEditSessions[this._sDocumentID];
                
                return;
            }
            
            // Fire client "load" callbacks.
            for (var i in this._aClients)
            {
                this._setClientInitialValue(this._aClients[i]);
                this._aClients[i].onDocumentLoad();
            }
        });
    },

    addClient: function(oClient)
    {
        // Assign the client an ID (username).
        this._iGeneratedClientNames++;
        oClient.setClientID('User ' + this._iGeneratedClientNames);
        
        // Add the client: Automatically allow editing if you're the only client.
        this._aClients.push(oClient);
        
        // Initialize client.
        if (this._bDocumentLoaded)
        {
            this._setClientInitialValue(oClient);
            oClient.onDocumentLoad();
        }
                
        // Propagate to the other clients.
        if (this._bDocumentLoaded && !oClient.isPreview())
        {
            this._broadcastAction(oClient,
            {
                sType: 'addClient',
                oData:
                {
                    sClientID: oClient.getClientID()
                }
            });
            this._broadcastAction(oClient, {
                sType: 'setRemoteSelection',
                oData:
                {
                    sClientID: oClient.getClientID(),
                    oRange: oClient.getSelectionRange()                    
                }
            });
        }
    },
    
    removeClient: function(oClient)
    {
        // Remove the client first thing, so we don't accidentally send him events.
        var iIndex = this._aClients.indexOf(oClient);
        this._aClients.splice(iIndex, 1);
        
        // Close the document (if no editors left).
        if (this._aClients.length === 0)
        {
            this._save(oHelpers.createCallback(this, function()
            {
                if (this._aClients.length === 0)
                    delete g_oEditSessions[this._sDocumentID];
            }));
        }
        
        // Update other clients (if document loaded).
        else if (this._bDocumentLoaded)
        {
            if (this._aCurrentlyTyping.indexOf(oClient) >= 0)
            {
                this._broadcastAction(oClient,
                {
                    sType: 'endTyping',
                    oData: {
                        sClientID: oClient.getClientID()
                    }
                });
                this._aCurrentlyTyping.splice(this._aCurrentlyTyping.indexOf(oClient), 1);
            }
            
            this._broadcastAction(oClient,
            {
                sType: 'removeClient',
                oData: {
                    sClientID: oClient.getClientID()
                }
            });            
        }
    },

    _setClientInitialValue: function(oClient)
    {
        this._assertDocumentLoaded();
        
        // Send ID (Username).
        oClient.sendAction('connect',
        {
            'sClientID': oClient.getClientID()
        });
        
        // Send documentID on document creation.
        if (oClient.createdDocument())
        {
            oClient.sendAction('setDocumentID',
            {
                sDocumentID: this._sDocumentID
            });
        }
        
        // Otherwise, Send current document state.
        else
        {
            // Set document text.
            oClient.sendAction('setDocumentData',
            {
                aLines: this._oDocument.get('aLines'),
                iServerState: this._iServerState,
                bUseSoftTabs: this._oDocument.get('bUseSoftTabs'),
                iTabSize: this._oDocument.get('iTabSize'),
                bShowInvisibles: this._oDocument.get('bShowInvisibles'),
                bUseWordWrap: this._oDocument.get('bUseWordWrap'),
            });
            
            // Set mode (language.)
            oClient.sendAction('setMode',
            {
                sMode: this._oDocument.get('sMode')
            });

	    //set Result(output)
            oClient.sendAction('setDocumentResult',
	        {
		        sResult: this._oDocument.get('sResult')
	        });

            //set Compile Output
            oClient.sendAction('setDocumentCompile',
                {
                    sCompile: this._oDocument.get('sCompile')
                });

            // Set title.
            oClient.sendAction('setDocumentTitle', 
            {
                sTitle: this._oDocument.get('sTitle')
            });
            
            // Set currently viewing.
            for (var iClientIndex in this._aClients)
            {
                var oOtherClient = this._aClients[iClientIndex];
                if (oOtherClient != oClient && !oOtherClient.isPreview()) // Skip previewing clients.
                {
                    oClient.sendAction('addClient',
                    {
                        'sClientID': oOtherClient.getClientID()
                    });
                    oClient.sendAction({
                        sType: 'setRemoteSelection',
                        oData:
                        {
                            sClientID: oOtherClient.getClientID(),
                            oRange: oOtherClient.getSelectionRange()                    
                        }
                    });
                }
            }         
                        
            // Set currently typing users.
            for (var i = 0; i < this._aCurrentlyTyping.length; i++)
            {
                oClient.sendAction('startTyping',
                {
                    'sClientID': this._aCurrentlyTyping[i].getClientID()
                });
            }
        }
        
        // Send snapshots.
        for (var i = 0; i < this._oDocument.get('aSnapshots').length; i++)
        {
            var oSnapshot = this._oDocument.get('aSnapshots')[i];
            oClient.sendAction('addSnapshot', oSnapshot);
        }
        
        // Set auto refresh preview.
        oClient.sendAction('setAutoRefreshPreview',
        {
            bAutoRefreshPreview: this._oDocument.get('bAutoRefreshPreview')
        });
    },
    
    getDocument: function()
    {
        this._assertDocumentLoaded();
        return this._oDocument;
    },
  
    onClientAction: function(oClient, oAction)
    {
        oHelpers.assert(!this._oDocument.get('bIsSnapshot'), 'Clients can\'t send actions to a published document.');
        
        this._assertDocumentLoaded();
		
		switch(oAction.sType)
        {
            case 'setMode':
                this._broadcastAction(oClient, oAction);
                this._oDocument.set('sMode', oAction.oData.sMode);
                break;
                
            case 'setSelection':
                
                // Transform selection range.
                this._tranformToCurState(oClient, oAction.oData.oRange, oAction.oData.iState, 'range');
                
                // Save selection.
                oClient.setSelectionRange(oAction.oData.oRange);
                
                // Broadcast.
                this._broadcastAction(oClient,
                {
                    sType: 'setRemoteSelection',
                    oData:
                    {
                        sClientID: oClient.getClientID(),
                        oRange: oAction.oData.oRange                    
                    }
                });
                break;
            
            case 'setDocumentTitle':
                this._broadcastAction(oClient, oAction);
                this._oDocument.set('sTitle', oAction.oData.sTitle);
		        break;

	         case 'setDocumentResult':
		        this._broadcastAction(oClient, oAction);
                this._oDocument.set('sResult', oAction.oData.sResult, 'sRunStatus', oAction.oData.sRunStatus );
                break;

            case 'setDocumentCompile':
                this._broadcastAction(oClient, oAction);
                this._oDocument.set('sCompile', oAction.oData.sCompile, 'sCompileStatus', oAction.oData.sCompileStatus);
                break;

            case 'setDocumentState':
                this._broadcastAction(oClient, oAction);
                this._oDocument.set('sState', oAction.oData.sState);
                break;
            
            case 'docChange':
                
                // Transform delta range.
                var oDelta = oAction.oData.oDelta;
                this._tranformToCurState(oClient, oDelta, oAction.oData.iState, 'delta');
                
                // Transform client selections.
                for (var i in this._aClients)
                {
                    var bPushEqualPoints = (this._aClients[i] == oClient); // Always push a client's own selection.
                    oOT.transformRange(oDelta, this._aClients[i].getSelectionRange(), bPushEqualPoints);
                }
                
                // Record in DeltaHistory.
                this._aDeltaHistory.push(
                {
                    oClient: oClient,
                    oDelta: oDelta
                });
                this._iServerState++;
                
                // Brodcast.
                this._broadcastAction(oClient,
                {
                    sType: 'docChange',
                    oData:
                    {
                        oDelta: oDelta,
                        iServerState: this._iServerState,
                        sClientID: oClient.getClientID()
                    }
                });
                
                // Notify send of receipt.
                oClient.sendAction('eventReciept',
                {
                    iServerState: this._iServerState
                });
                
                // Apply locally.
                this._oDocument.applyDelta(oDelta);
                this._setAutoSaveTimeout();
                break;
            
            // People Pane
            case 'newChatMessage':
                var oNewAction = {
                    sType: 'newChatMessage',
                    oData: {
                        sClientID: oClient.getClientID(),
                        sMessage: oAction.oData.sMessage
                    }
                };
                this._broadcastAction(oClient, oNewAction);
                this._setAutoSaveTimeout();
                break;
                
            case 'changeClientID':
                
                var sNewClientID = oAction.oData.sClientID;
                
                // Check for errors
                var sError = '';
                if (!sNewClientID)
                    sError = 'ClientID may not be blank.';
                
                for (var i = 0; i < this._aClients.length; i++)
                {
                    if (this._aClients[i] != oClient && this._aClients[i].getClientID() == sNewClientID)
                        sError = 'This username has already been taken.';
                }
                
                // Handle errors
                if (sError)
                {
                    oClient.sendAction('invalidClientIDChange',
                    {
                        'sReason': sError
                    });
                    break;
                }
                
                // Remove old user
                // TODO: This is a bit of a hack.
                this._broadcastAction(oClient,
                {
                    sType: 'removeClient',
                    oData:
                    {
                        sClientID: oClient.getClientID()
                    }
                });
                
                // Tell client his new name.
                oClient.sendAction('newClientIDAccepted', 
                {
                    'sClientID': sNewClientID
                });                
                oClient.setClientID(sNewClientID);
                
                // Add the new client to the list of viewing people.
                this._broadcastAction(oClient,
                {
                    sType: 'addClient',
                    oData:
                    {
                        sClientID: oClient.getClientID()
                    }
                });
                this._broadcastAction(oClient,
                {
                    sType: 'setRemoteSelection',
                    oData:
                    {
                        sClientID: oClient.getClientID(),
                        oRange: oClient.getSelectionRange()
                    }
                });
                break;
                
            case 'startTyping':
                this._aCurrentlyTyping.push(oClient);
                this._broadcastAction(oClient,
                {
                    sType: 'startTyping',
                    oData: {
                        sClientID: oClient.getClientID()
                    }
                });
                break;

            case 'endTyping':
                this._aCurrentlyTyping.splice(this._aCurrentlyTyping.indexOf(oClient), 1);
                this._broadcastAction(oClient,
                {
                    sType: 'endTyping',
                    oData: {
                        sClientID: oClient.getClientID()
                    }
                });
                break;
            
            case 'snapshotDocument':
                
                this._assertDocumentLoaded();
                
                // Copy document.
                var oNewDocument = this._oDocument.clone(true);
                
                // Save document copy.
                oDatabase.createDocument(oNewDocument.toJSON(), this, function(sID)
                {
                    var oSnapshot = {
                        sID: sID,
                        oDateCreated: oNewDocument.get('oDateCreated')
                    };
                    this._oDocument.get('aSnapshots').push(oSnapshot);
                    this._broadcastAction(null,
                    {
                        sType: 'addSnapshot', 
                        oData: oSnapshot
                    });
                });
                
                break;
                
            case 'setUseSoftTabs':
                this._oDocument.set('bUseSoftTabs', oAction.oData.bUseSoftTabs);
                this._broadcastAction(oClient, oAction);
                break;
                
            case 'setTabSize':
                this._oDocument.set('iTabSize', oAction.oData.iTabSize);
                this._broadcastAction(oClient, oAction);
                break;
                
            case 'setShowInvisibles':
                this._oDocument.set('bShowInvisibles', oAction.oData.bShowInvisibles);
                this._broadcastAction(oClient, oAction);
                break;
            
            case 'setUseWordWrap':
                this._oDocument.set('bUseWordWrap', oAction.oData.bUseWordWrap);
                this._broadcastAction(oClient, oAction);
                break;
            
            case 'setAutoRefreshPreview':
                this._oDocument.set('bAutoRefreshPreview', oAction.oData.bAutoRefreshPreview);
                this._broadcastAction(oClient, oAction);
                break;
            
            case 'refreshPreview':
                this._broadcastAction(oClient, oAction);
                break;
                
            default:
                oHelpers.assert(false, 'Unrecognized event type: "' + oAction.sType + '"');
        }
    },

    _broadcastAction: function(oSendingClient /*May be null*/, oAction)
    {
        // Send actions to all other clients.
        this._assertDocumentLoaded();
        for (var i = 0; i < this._aClients.length; i++)
        {
            // Don't broadcast events back to the sending clients.
            var oClient = this._aClients[i];
            if(oClient != oSendingClient)
                oClient.sendAction(oAction)
        }
    },
    
    _tranformToCurState: function(oClient, oObj, iState, sType)
    {
        var iCatchUp = this._iServerState - iState;
        for (var i = this._aDeltaHistory.length - iCatchUp; i < this._aDeltaHistory.length; i++)
        {
            // Get past delta info.
            var oOtherDelta  = this._aDeltaHistory[i].oDelta;
            var oOtherClient = this._aDeltaHistory[i].oClient;
            
            // Don't transform a range for the client's own past events,
            // since the range already reflects those.
            if (oOtherClient != oClient)
            {
                switch(sType)
                {
                    case 'range': oOT.transformRange(oOtherDelta, oObj); break;
                    case 'delta': oOT.transformDelta(oOtherDelta, oObj); break;
                    default:      oHelpers.assert(false, 'Invalid type.');
                }
            }
        }
    },
    
    _save: function()
    {
        if (this._oDocument.get('bIsSnapshot'))
            return;
        
        this._assertDocumentLoaded();
        this._clearAutoSaveTimeout();
        
        oDatabase.saveDocument(this._sDocumentID, this._oDocument.toJSON(), this, function(sError)
        {
            // TODO: Handle save errors.
            oHelpers.assert(!sError, 'Save Error: ' + sError);
        });
    },
    
    _setAutoSaveTimeout: function()
    {
        if (this._iAutoSaveTimeout === null)
        {
            var fnSave = oHelpers.createCallback(this, this._save);
            this._iAutoSaveTimeoutID = setTimeout(fnSave, this._iAutoSaveTimeoutLength);
        }        
    },
    
    _clearAutoSaveTimeout: function()
    {
        clearTimeout(this._iAutoSaveTimeoutID);
        this._iAutoSaveTimeoutID = null;        
    },
    
    _assertDocumentLoaded: function()
    {
        oHelpers.assert(this._bDocumentLoaded, 'Document not yet initialized.');
    },
});
