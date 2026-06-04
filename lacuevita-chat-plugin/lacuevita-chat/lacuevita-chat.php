<?php
/**
 * Plugin Name: La Cuevita Chat Widget
 * Description: Bilingual EN/ES chat widget for La Cuevita Furniture
 * Version: 1.0
 * Author: La Cuevita
 */

if ( ! defined( 'ABSPATH' ) ) exit;

function lacuevita_enqueue_chat() {
    wp_enqueue_script(
        'lacuevita-chat',
        plugin_dir_url( __FILE__ ) . 'lacuevita-chat-embed.js',
        array(),
        '1.0',
        true
    );
}
add_action( 'wp_enqueue_scripts', 'lacuevita_enqueue_chat' );
