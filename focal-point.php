<?php
/**
 * Plugin Name: Thumbnails Focal Point
 */
define( 'FOCAL_POINT_VERSION', '2.0.14' );

function focal_get_image_size_crop( $size ) {
    if ( is_array( $size ) ) {
        return true; //todo: implement size array to string
    }

    global $_wp_additional_image_sizes;

    if ( in_array( $size, [ 'thumbnail', 'medium', 'medium_large', 'large' ] ) ) {
        return (bool) get_option( "{$size}_crop" );
    }

    if ( isset( $_wp_additional_image_sizes[ $size ] ) ) {
        return $_wp_additional_image_sizes[ $size ]['crop'];
    }

    return false;
}

function focal_get_file_etag( $url ) {
    $response = wp_remote_get( $url, [
        'sslverify' => false,
    ] );

    if ( is_wp_error( $response ) ) {
        return '';
    }

    return wp_remote_retrieve_header( $response, 'Etag' );
}

add_filter( 'attachment_fields_to_edit', function( $form_fields, $post ) {
    if ( empty( $form_fields ) ) {
        $form_fields = [];
    }

    list( $src, $w, $h ) = wp_get_attachment_image_src( $post->ID, 'medium' );

    if ( !$w || !$h ) {
        return $form_fields;
    }

    $selector = "<div class=\"focal-point-selector\">
                    <img style=\"display: none\" src=\"{$src}\" alt=\"\" />
                    <div id=\"focal-cursor-{$post->ID}\" class=\"focal-cursor\"></div>
                    <div id=\"focal-selector-{$post->ID}\" class=\"focal-overlay\"></div>
                </div>";

    $html = "$selector <script>jQuery(function(){wp.media.attachment.focalPoint({$post->ID});});</script>";

    $form_fields['focal-html'] = [
        'label' => '<span id="focal-spinner" class="spinner"></span>',
        'input' => 'html',
        'html' => $html,
    ];

    $center = get_post_meta( $post->ID, 'focal-center', true );

    if ( !$center ) {
        $center = '50.0,50.0';
    }

    $form_fields['focal-center'] = [
        'label' => false,
        'input' => 'text',
        'value' => $center
    ];

    return $form_fields;
}, 10, 2 );

add_action( 'admin_enqueue_scripts', function () {
    wp_enqueue_script( 'focal-point-admin-js', plugin_dir_url( __FILE__ ) . '/admin.js', [ 'jquery' ], FOCAL_POINT_VERSION, true );
    wp_enqueue_style( 'focal-point-admin-css', plugin_dir_url( __FILE__ ) . '/admin.css', FOCAL_POINT_VERSION );
} );

add_action( 'edit_attachment', function ( $attachment_id ) {
    if ( isset( $_REQUEST['attachments'] ) && isset( $_REQUEST['attachments'][ $attachment_id ] ) && isset( $_REQUEST['attachments'][ $attachment_id ]['focal-center'] ) ) {
        update_post_meta( $attachment_id, 'focal-center', $_REQUEST['attachments'][ $attachment_id ]['focal-center'] );
        update_post_meta( $attachment_id, '_thumbnail_header_etag', focal_get_file_etag( wp_get_attachment_image_src( $attachment_id )[0] ) );
        delete_transient( 'doing_cron' );
        wp_schedule_single_event( time() - 1, 'attachment_crop', [ $attachment_id ] );
        spawn_cron();
    }
} );

add_filter( 'intermediate_image_sizes_advanced', function ( $sizes, $metadata ) {
    if ( $metadata['file'] ) {
        $GLOBALS['__attachment_crop_id'] = attachment_url_to_postid( $metadata['file'] );
    }

    return $sizes;
}, 10, 2 );

add_action( 'attachment_crop', function ( $attachment_id ) {
    $center = get_post_meta( $attachment_id, 'focal-center', true );
    $prev_center = get_post_meta( $attachment_id, 'focal-center-prev', true );

    if ( $prev_center && $prev_center === $center ) {
        return;
    }

    @set_time_limit(0);
    require_once ABSPATH . 'wp-admin/includes/image.php';

    $fullsizepath = get_attached_file( $attachment_id );

    if ( false === $fullsizepath ) {
        return;
    }

    add_filter( 'intermediate_image_sizes_advanced', function ( $sizes ) {
        $crop_sizes = [];

        foreach ( $sizes as $name => $size ) {
            if ( !$size['crop'] ) {
                continue;
            }

            $crop_sizes[ $name ] = $size;
        }

        return $crop_sizes;
    } );

    $metadata = wp_generate_attachment_metadata( $attachment_id, $fullsizepath );

    if ( is_wp_error( $metadata ) || empty( $metadata ) ) {
        return;
    }

    wp_update_attachment_metadata( $attachment_id, $metadata );
    update_post_meta( $attachment_id, 'focal-center-prev', $center );
    update_post_meta( $attachment_id, '_version', time() );
} );

add_filter( 'wp_get_attachment_image_src', function ( $image, $attachment_id, $size ) {
    if ( $image && focal_get_image_size_crop( $size ) && ( $version = get_post_meta( $attachment_id, '_version', true ) ) ) {
        $image[0] = add_query_arg( 'ver', $version, $image[0] );
    }

    return $image;
}, 10, 3 );

add_filter( 'wp_calculate_image_srcset', function( $sources, $size_array, $image_src, $image_meta, $attachment_id ) {
    if ( $version = get_post_meta( $attachment_id, '_version', true ) ) {
        foreach( $sources as $width => $data ) {
            $sources[ $width ]['url'] = add_query_arg( 'ver', $version, $data['url'] );
        }
    }

    return $sources;
}, 10, 5 );

add_filter( 'image_resize_dimensions', function( $dimensions, $orig_w, $orig_h, $dest_w, $dest_h, $crop  ) {
    if ( !$crop ) {
        return $dimensions;
    }

    if ( !isset( $GLOBALS['__attachment_crop_id'] ) || ! $GLOBALS['__attachment_crop_id'] || ! wp_attachment_is_image( $GLOBALS['__attachment_crop_id'] ) ) {
        return $dimensions;
    }

    $center = get_post_meta( $GLOBALS['__attachment_crop_id'], 'focal-center', true );

    if ( !$center ) {
        return $dimensions;
    }

    list( $center_x, $center_y ) = explode( ',', $center );

    $aspect_ratio = $orig_w / $orig_h;
    $new_w = min( $dest_w, $orig_w );
    $new_h = min( $dest_h, $orig_h );

    if ( !$new_w ) {
        $new_w = (int) round( $new_h * $aspect_ratio );
    }

    if ( !$new_h ) {
        $new_h = (int) round( $new_w / $aspect_ratio );
    }

    $size_ratio = max( $new_w / $orig_w, $new_h / $orig_h );

    $crop_w = round( $new_w / $size_ratio );
    $crop_h = round( $new_h / $size_ratio );

    $s_x = floor( $orig_w * $center_x / 100.0 - $crop_w / 2.0 );
    $s_y = floor( $orig_h * $center_y / 100.0 - $crop_h / 2.0 );

    $s_x = min( max( $s_x, 0 ), $orig_w - $crop_w );
    $s_y = min( max( $s_y, 0 ), $orig_h - $crop_h );

    if ( $new_w >= $orig_w && $new_h >= $orig_h && $dest_w != $orig_w && $dest_h != $orig_h ) {
        return $dimensions;
    }

    return [ 0, 0, (int) $s_x, (int) $s_y, (int) $new_w, (int) $new_h, (int) $crop_w, (int) $crop_h ];
}, 99, 6 );

add_filter( 'attachment_fields_to_edit', function( $form_fields, $post ) {
    if( empty( $form_fields ) ) {
        $form_fields = [];
    }

    list( $src, $w, $h ) = wp_get_attachment_image_src( $post->ID, 'medium' );

    if ( !$w || !$h ) {
        return $form_fields;
    }

    $src_ratio = $w / $h;

    $preview_height = 100;
    $sizes = [];

    $duplicates = [];
    $allowed = apply_filters( 'focal_previews_sizes', [] );

    $metadata = wp_get_attachment_metadata( $post->ID );
    $attachment_sizes = isset( $metadata['sizes'] ) ? $metadata['sizes'] : [];

    global $_wp_additional_image_sizes;

    foreach ( $allowed as $size ) {
        if ( isset( $_wp_additional_image_sizes[ $size ] ) && isset( $attachment_sizes[ $size ] ) ) {
            $image_sizes = $_wp_additional_image_sizes[ $size ];

            if ( !$image_sizes['crop'] ) {
                continue;
            }

            $ratio = $image_sizes['width'] / $image_sizes['height'];
            $preview = [
                'height' => $preview_height,
                'width' => round( $preview_height * $ratio )
            ];
            $duplicate_key = $preview['width'] . 'x' . $preview['height'];

            if ( in_array( $duplicate_key, $duplicates ) ) {
                continue;
            }

            $duplicates[] = $duplicate_key;
            $source = [];

            if ( $src_ratio > $ratio ) {
                //crop width
                $source['height'] = $preview['height'];
                $source['width'] = round( $source['height'] * $src_ratio );
            } else {
                // crop height
                $source['width'] = $preview['width'];
                $source['height'] = round( $source['width'] / $src_ratio );
            }

            $sizes[] = [
                'name' => $size,
                'preview' => $preview,
                'source' => $source,
            ];
        }
    }

    $html_items = [];

    foreach( $sizes as $size ) {
        $html_items[] = "
            <li class=\"focal-preview\" style=\"width: {$size['preview']['width']}px; height: {$size['preview']['height']}px; display: none;\">
                <img src=\"{$src}\" alt=\"\" style=\"width: {$size['source']['width']}px; height: {$size['source']['height']}px;\" />
            </li>";
    }

    $form_fields['focal-preview'] = [
        'label' => '',
        'input' => 'html',
        'html'  => '<ul id="focal-previews" class="focal-previews">' . implode( '', $html_items ) . '</ul>',
    ];

    return $form_fields;
}, 10, 2 );

add_filter( 'wp_prepare_attachment_for_js', function ( $response, $attachment, $meta ) {
    if ( false !== ( $version = get_post_meta( $attachment->ID, '_version', true ) ) ) {
        if ( $meta && isset( $response['type'] ) && $response['type'] == 'image' ) {
            $response['meta']['focalVersion'] = intval( $version );
        }

        if ( isset( $response['url'] ) ) {
            $response['url'] = add_query_arg( 'ver', $version, $response['url'] );
        }

        if ( isset( $response['sizes'] ) && is_array( $response['sizes'] ) ) {
            foreach ( $response['sizes'] as $size => $image ) {
                if ( focal_get_image_size_crop( $size ) ) {
                    $response['sizes'][ $size ]['url'] = add_query_arg( 'ver', $version, $image['url'] );
                }
            }
        }
    }

    return $response;
}, 10, 3 );

add_filter( 'heartbeat_received', function ( $response, $data ) {
    if ( isset( $data['focal_point'] ) && is_array( $data['focal_point'] ) ) {
        $processed = [];

        foreach ( $data['focal_point'] as $attachment_id => $version ) {
            if ( !isset( $processed[ $attachment_id ] ) ) {
                $_version = get_post_meta( $attachment_id, '_version', true );
                $center = get_post_meta( $attachment_id, 'focal-center', true );
                $prev_center = get_post_meta( $attachment_id, 'focal-center-prev', true );
                $_etag = get_post_meta( $attachment_id, '_thumbnail_header_etag', true );
                $etag = focal_get_file_etag( wp_get_attachment_image_src( $attachment_id )[0] );

                if ( $prev_center && $prev_center === $center && $_version > $version && ( $_etag === '' || $_etag !== $etag ) ) {
                    update_post_meta( $attachment_id, '_thumbnail_header_etag', $etag );
                    $processed[ $attachment_id ] = wp_prepare_attachment_for_js( $attachment_id );
                }
            }
        }

        if ( !empty( $processed ) ) {
            $response['focal_processed'] = array_values( $processed );

            if ( count( $data['focal_point'] ) == count( $processed ) ) {
                $response['heartbeat_interval'] = 'slow';
            }
        }
    }

    return $response;
}, 10, 2 );