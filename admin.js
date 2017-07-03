(function ($) {

    'use strict';

    var $document = $(document);

    var resizeOffset = function (centerX, centerY, origW, origH, destW, destH) {
        var aspect_ratio = 1.0 * origW / origH;
        var newW = Math.min(destW, origW);
        var newH = Math.min(destH, origH);

        if ( ! newW ) {
            newW = Math.round( newH * aspect_ratio );
        }

        if ( ! newH ) {
            newH = Math.round( newW / aspect_ratio );
        }

        var size_ratio = Math.max( newW / origW, newH / origH );

        var cropW = Math.round( newW / size_ratio );
        var cropH = Math.round( newH / size_ratio );

        var sX = Math.floor(origW * centerX / 100.0 - cropW / 2.0);
        var sY = Math.floor(origH * centerY / 100.0 - cropH / 2.0);

        if(sX < 0) sX = 0;
        if(sY < 0) sY = 0;
        if(sX > (origW - cropW)) sX = origW - cropW;
        if(sY > (origH - cropH)) sY = origH - cropH;

        return [sX, sY];
    };

    var addQueryArg = function (uri, key, value) {
        var re = new RegExp('([?&])' + key + '=.*?(&|#|$)', 'i');
        var hash = '';
        var separator;

        if (uri.match(re)) {
            return uri.replace(re, '$1' + key + '=' + value + '$2');
        } else {
            if (uri.indexOf('#') !== -1 ){
                hash = uri.replace(/.*#/, '#');
                uri = uri.replace(/#.*/, '');
            }

            separator = uri.indexOf('?') !== -1 ? '&' : '?';

            return uri + separator + key + "=" + value + hash;
        }
    };

    var api = function (id) {
        var $cursor = $('#focal-cursor-' + id);
        var $selector = $('#focal-selector-' + id);
        var $previews = $('#focal-previews');

        api.$spinner = $('#focal-spinner');

        if (api.id === id) {
            api.$spinner.addClass('is-active');
        } else {
            api.id = id;
        }

        api.$field = $('#attachments-' + id + '-focal-center');
        api.cursorPos = api.$field.val().split(',').map(function(i){return parseFloat(i);});

        var updateCursorPos = function (x, y) {
            if(x < 0) { x = 0; }
            if(y < 0) { y = 0; }
            if(x > 100) { x = 100; }
            if(y > 100) { y = 100; }

            api.cursorPos = [x, y];
            $cursor.css({
                left: x + '%',
                top: y + '%'
            });

            $previews.find('li').each(function () {
                var $img = $(this).find('img:first');
                var offset = resizeOffset(x, y, $img.width(), $img.height(), $(this).width(), $(this).height());
                $img.css({
                    marginLeft: - offset[0],
                    marginTop: - offset[1]
                });
            })
        };

        updateCursorPos(api.cursorPos[0], api.cursorPos[1]);

        $selector.on('mousedown', function (e) {
            e.preventDefault();
            var x = e.offsetX;
            var y = e.offsetY;
            updateCursorPos(100.0 * x / $selector.width(), 100.0 * y / $selector.height());
            api.dragging = true;
        });

        $selector.on('mousemove', function (e) {
            e.preventDefault();
            if (api.dragging) {
                var x = e.offsetX;
                var y = e.offsetY;
                updateCursorPos(100.0 * x / $selector.width(), 100.0 * y / $selector.height());
            }
        });
    };

    api.id = 0;
    api.dragging = false;
    api.saveTimer = null;
    api.$field = null;
    api.$spinner = null;
    api.cursorPos = [0, 0];
    api.heartbeat = '';

    $document.on('mouseup', function () {
        if(api.dragging) {
            api.dragging = false;
            if (api.saveTimer) {
                clearTimeout(api.saveTimer);
            }
            api.saveTimer = setTimeout(function() {
                if (api.$spinner) {
                    api.$spinner.addClass('is-active');
                }
                if (api.$field) {
                    api.$field.val(api.cursorPos.join(',')).change();
                }
                api.heartbeat = 'refresh';
                wp.heartbeat.interval('fast');
            }, 800);
        }
    });

    $document.on('heartbeat-send', function (event, data) {
        if (api.heartbeat !== '') {
            data.focal_point = api.heartbeat;
        }
    });

    $document.on('heartbeat-tick', function (event, data) {
        if (data.focal_processed && $.isArray(data.focal_processed)) {
            setTimeout(function (data) {
                $.each(data.focal_processed, function (index, data) {
                    var $editorImg;
                    var editorImgSrc;

                    wp.media.attachment(data.id).set(data);

                    if (api.id === data.id) {
                        api.id = 0;
                    }

                    if (typeof tinymce !== 'undefined' && tinymce.activeEditor && data.meta) {
                        $editorImg = tinymce.activeEditor.$('img[src^="' + data.url.replace(/\.[^.]+$/, '') + '"]');

                        if ($editorImg.length) {
                            editorImgSrc = addQueryArg($editorImg.attr('src'), 'ver', data.meta.focalVersion);
                            $editorImg
                                .attr('src', editorImgSrc)
                                .attr('data-mce-src', editorImgSrc);
                        }
                    }
                });
                if (api.$spinner) {
                    api.$spinner.removeClass('is-active');
                }
                api.heartbeat = '';
            }, 4000, data);
        }
    });

    window.wp.media.attachment.focalPoint = api;

})(jQuery);