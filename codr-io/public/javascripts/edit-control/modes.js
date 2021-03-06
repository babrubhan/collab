define(function(require)
{
    // Dependencies
    // Requires jQuery.
    var oHelpers     = require('helpers/helpers-web'),
        Menu         = require('helpers/menu'),
        oAceModeList = require('./ace-ext-modelist');
    
    // Select favorite modes.
   // var aCodrFavModeNames = ['text', 'html', 'javascript', 'css', 'python', 'mysql'];
    var aCodrFavModeNames = ['C_Cpp'];
    
    var CodrMode = oHelpers.createClass(
    {
        _oAceMode: null,
        //_sDefaultExtension: 'c|cc|cxx|h|hh|hpp',
        _sDefaultExtension: 'c',
        
        __init__: function(oAceMode)
        {
            // Store ace mode.
            this._oAceMode = oAceMode;
            
            // Store default extension.
            var aExtensions = this._oAceMode.extensions.split('|');
            for (var i in aExtensions)
            {
                if (!oHelpers.strStartsWith(aExtensions[i], '^'))
                {
                    this._sDefaultExtension = aExtensions[i];
                    break;
                }
            }
        },
        
        supportsFile: function(sFileName)
        {
            return this._oAceMode.supportsFile(sFileName); 
        },
        
        getName: function()
        {
            return this._oAceMode.name;  
        },
        
        getDisplayName: function()
        {
            return this._oAceMode.caption;
        },
        
        getPath: function()
        {
            return this._oAceMode.mode;
        },
        
        /*isFavorite: function()
        {
           return $.inArray(this.getName(), aCodrFavModeNames) != -1;
        },*/
        
        getDefaultExtension: function()
        {
            return this._sDefaultExtension;
        }
    });


    // Wrap Ace's mode objects in our own.
    // Sort Favorite modes to top.
    var aCodrModes = [];
    var oCodrModesByName = {};
    for (var iModeOffset = 0; iModeOffset < oAceModeList.modes.length; iModeOffset++)
    {
        // Push CodrMode (excluding favorites).
        var oCodrMode = new CodrMode(oAceModeList.modes[iModeOffset]);
        //if (!oCodrMode.isFavorite())
            aCodrModes.push(oCodrMode);
        
        // Map CodrMode by name.
        oCodrModesByName[oCodrMode.getName()] = oCodrMode;
    }
    
    // Prefix favorite modes to list in order.
    /*var aFavModes = [];
    for (var iNameOffset in aCodrFavModeNames)
    {
        var sName = aCodrFavModeNames[iNameOffset];
        var oCodrMode = oCodrModesByName[sName];
        aFavModes.push(oCodrMode);
    }
    aCodrModes = aFavModes.concat(aCodrModes);*/
    
    // Return modes object.
    return { 
        
        aModes:            aCodrModes,
        oModesByName:      oCodrModesByName,
       // iNumFavoriteModes: aFavModes.length,
        createModeMenu:    function(jParent, sBtnText, oScope, fnOnModeSelect)
        {
            return new Menu(
            {
                aOptions:            this.aModes,
                jParent:             jParent,
                sBtnText:            sBtnText,
                sPlaceHolderText:    'Filter Languages',
               // iNumFavoriteOptions: this.iNumFavoriteModes,
                oScope:              null,
                fnGetKey:            function(oMode) { return oMode.getName();         },
                fnRenderOption:      function(oMode)
                {
                    return oMode.getDisplayName() + (oMode.getName() == 'html' ? '<span class="badge">Instant Preview</preview>' : '');
                },
                fnOnSelect:          oHelpers.createCallback(oScope, fnOnModeSelect)
            });
        }
    }
});

