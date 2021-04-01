/*
    Native.js

    This script is used to match the Music Player to as native as possible
    for some advanced use case (like PWA)
*/

//Native Media Player
function updateTitle(){
    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
        title: 'Unforgettable',
        artist: 'Nat King Cole',
        album: 'The Ultimate Collection (Remastered)',
        artwork: [
            { src: 'https://dummyimage.com/96x96',   sizes: '96x96',   type: 'image/png' },
            { src: 'https://dummyimage.com/128x128', sizes: '128x128', type: 'image/png' },
            { src: 'https://dummyimage.com/192x192', sizes: '192x192', type: 'image/png' },
            { src: 'https://dummyimage.com/256x256', sizes: '256x256', type: 'image/png' },
            { src: 'https://dummyimage.com/384x384', sizes: '384x384', type: 'image/png' },
            { src: 'https://dummyimage.com/512x512', sizes: '512x512', type: 'image/png' },
        ]
        });
    
        navigator.mediaSession.setActionHandler('play', function() { /* Code excerpted. */ });
        navigator.mediaSession.setActionHandler('pause', function() { /* Code excerpted. */ });
        navigator.mediaSession.setActionHandler('stop', function() { /* Code excerpted. */ });
        navigator.mediaSession.setActionHandler('seekbackward', function() { /* Code excerpted. */ });
        navigator.mediaSession.setActionHandler('seekforward', function() { /* Code excerpted. */ });
        navigator.mediaSession.setActionHandler('seekto', function() { /* Code excerpted. */ });
        navigator.mediaSession.setActionHandler('previoustrack', function() { /* Code excerpted. */ });
        navigator.mediaSession.setActionHandler('nexttrack', function() { /* Code excerpted. */ });
        navigator.mediaSession.setActionHandler('skipad', function() { /* Code excerpted. */ });
    }
}