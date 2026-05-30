import sys
import os
import json
import urllib.parse as urlparse
from flask import Flask, request, jsonify, redirect
from ytmusicapi import YTMusic
import yt_dlp
import threading

app = Flask(__name__)

@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
    response.headers['Access-Control-Allow-Methods'] = 'GET,PUT,POST,DELETE,OPTIONS'
    return response

# Determine auth file location in the same directory as server.py
AUTH_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'headers_auth.json')

# Initialize YTMusic
if os.path.exists(AUTH_FILE):
    try:
        ytmusic = YTMusic(AUTH_FILE)
        print("[Sonart Server] Authenticated YTMusic initialized.")
    except Exception as e:
        print(f"[Sonart Server] Failed to load auth file: {e}. Falling back to unauthenticated.", file=sys.stderr)
        ytmusic = YTMusic()
else:
    ytmusic = YTMusic()
    print("[Sonart Server] Unauthenticated YTMusic initialized.")

# ── RESPONSE CACHE (in-memory, TTL-based) ─────────────────────────
_cache = {}
_cache_lock = threading.Lock()
CACHE_TTL = 1200  # 20 minutes default

def cache_get(key):
    import time
    with _cache_lock:
        entry = _cache.get(key)
        if entry:
            ttl = entry.get('ttl', CACHE_TTL)
            if (time.time() - entry['ts']) < ttl:
                return entry['data']
    return None

def cache_set(key, data, ttl=CACHE_TTL):
    import time
    with _cache_lock:
        _cache[key] = {
            'data': data,
            'ts': time.time(),
            'ttl': ttl
        }

# ── HELPERS ────────────────────────────────────────────────────────

def get_artwork_url(item):
    thumbnails = item.get('thumbnails', [])
    url = ""
    if thumbnails:
        url = thumbnails[-1].get('url', '')
    
    # If no URL, use fallback YouTube thumbnail
    if not url:
        vid = item.get('videoId')
        if vid:
            return f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
        return ""
    
    # Optimize/resize the thumbnail to a high-res version if it's a googleusercontent URL
    if "googleusercontent.com" in url or "ggpht.com" in url:
        if "=" in url:
            base_url = url.split("=")[0]
            return f"{base_url}=w500-h500-c-rj"
        elif "-tmp" in url:
            base_url = url.split("-tmp")[0]
            return f"{base_url}-tmp=w500-h500-c-rj"
    return url

def parse_views(views_str):
    if not views_str:
        return 0
    try:
        views_str = str(views_str).strip().upper()
        # Remove commas, spaces, and text like "VIEWS" or "PLAYS"
        views_str = views_str.replace(",", "").replace("VIEWS", "").replace("PLAYS", "").replace("WATCHERS", "").replace("WATCHING", "").strip()
        
        # Check multipliers
        multiplier = 1
        if views_str.endswith('B'):
            multiplier = 1000000000
            views_str = views_str[:-1].strip()
        elif views_str.endswith('M'):
            multiplier = 1000000
            views_str = views_str[:-1].strip()
        elif views_str.endswith('K'):
            multiplier = 1000
            views_str = views_str[:-1].strip()
            
        return float(views_str) * multiplier
    except Exception:
        return 0

def format_track(song):
    """Normalize a ytmusicapi song/track dict into our standard format."""
    artists = song.get('artists', [])
    artist_name = ", ".join([a.get('name') for a in artists if a.get('name')]) if artists else "Unknown"
    vid = song.get('videoId')
    if not vid:
        return None
    
    raw_views = song.get('views') or ""
    if not raw_views and 'plays' in song:
        raw_views = song.get('plays') or ""

    return {
        'id': vid,
        'setVideoId': song.get('setVideoId'),
        'title': song.get('title', 'Untitled'),
        'user': { 'name': artist_name },
        'artwork': {
            '150x150': get_artwork_url(song),
            '480x480': get_artwork_url(song)
        },
        'views': str(raw_views),
        'views_count': parse_views(raw_views),
        'play_count': None
    }

def format_tracks(songs):
    out = []
    for s in songs:
        t = format_track(s)
        if t:
            out.append(t)
    return out

def parse_playlist_id(url_or_id):
    if not url_or_id:
        return None
    if "list=" in url_or_id:
        parsed = urlparse.urlparse(url_or_id)
        params = urlparse.parse_qs(parsed.query)
        return params.get('list', [None])[0]
    return url_or_id

# ── AUTHENTICATION ENDPOINTS ───────────────────────────────────────

@app.route('/auth/status', methods=['GET'])
def auth_status():
    is_authenticated = os.path.exists(AUTH_FILE)
    return jsonify({'authenticated': is_authenticated})

@app.route('/auth/setup', methods=['POST'])
def auth_setup():
    global ytmusic
    try:
        req_data = request.get_json() or {}
        headers_raw = req_data.get('headers', '')
        if not headers_raw:
            return jsonify({'error': 'No headers provided'}), 400

        # Try to detect if it's a JSON dict (from login window) or raw text (manual)
        try:
            parsed = json.loads(headers_raw)
            if isinstance(parsed, dict):
                # It's a JSON dict of headers from the login window capture
                # Write it directly as the auth file in ytmusicapi format
                auth_data = {
                    'User-Agent': parsed.get('User-Agent', parsed.get('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')),
                    'Accept': parsed.get('Accept', parsed.get('accept', '*/*')),
                    'Accept-Language': parsed.get('Accept-Language', parsed.get('accept-language', 'en-US,en;q=0.5')),
                    'Content-Type': 'application/json',
                    'X-Goog-AuthUser': parsed.get('X-Goog-AuthUser', parsed.get('x-goog-authuser', '0')),
                    'x-origin': parsed.get('x-origin', parsed.get('origin', 'https://music.youtube.com')),
                    'Cookie': parsed.get('Cookie', parsed.get('cookie', '')),
                    'Authorization': parsed.get('Authorization', parsed.get('authorization', 'SAPISIDHASH dummy'))
                }
                # Write directly as headers_auth.json
                with open(AUTH_FILE, 'w') as f:
                    json.dump(auth_data, f, indent=2)
                ytmusic = YTMusic(AUTH_FILE)
                # Clear caches so we get personalized data
                with _cache_lock:
                    _cache.clear()
                return jsonify({'success': True, 'authenticated': True})
        except (json.JSONDecodeError, TypeError):
            pass

        # Fallback: raw header text (manual paste)
        import ytmusicapi
        ytmusicapi.setup(filepath=AUTH_FILE, headers_raw=headers_raw)
        
        # Inject fallback Authorization header if missing in manual setup
        try:
            with open(AUTH_FILE, 'r') as f:
                auth_data = json.load(f)
            if 'Authorization' not in auth_data and 'authorization' not in auth_data:
                auth_data['Authorization'] = 'SAPISIDHASH dummy'
                with open(AUTH_FILE, 'w') as f:
                    json.dump(auth_data, f, indent=2)
        except Exception:
            pass

        ytmusic = YTMusic(AUTH_FILE)
        with _cache_lock:
            _cache.clear()
        return jsonify({'success': True, 'authenticated': True})
    except Exception as e:
        print(f"[Sonart Server] Auth setup error: {e}", file=sys.stderr)
        return jsonify({'error': str(e)}), 500

@app.route('/auth/logout', methods=['POST'])
def auth_logout():
    global ytmusic
    try:
        if os.path.exists(AUTH_FILE):
            os.remove(AUTH_FILE)
        ytmusic = YTMusic()
        with _cache_lock:
            _cache.clear()
        return jsonify({'success': True, 'authenticated': False})
    except Exception as e:
        print(f"[Sonart Server] Auth logout error: {e}", file=sys.stderr)
        return jsonify({'error': str(e)}), 500

# ── HOME FEED ENDPOINT ─────────────────────────────────────────────

@app.route('/home', methods=['GET'])
def home_feed():
    """
    Returns a structured home feed with multiple sections:
    - Page 0: Personalized recommendations, charts, and first 2 mood playlists.
    - Page 1+: Next slices of mood playlists from YouTube Music categories.
    """
    try:
        page = int(request.args.get('page', '0'))
    except ValueError:
        page = 0

    seed = request.args.get('seed', '')
    seed_title = request.args.get('seed_title', '')
    refresh = request.args.get('refresh', '') == 'true'

    cache_key = f'home_feed_page_{page}'
    if page == 0 and seed:
        cache_key += f'_seed_{seed}'

    if not refresh:
        cached = cache_get(cache_key)
        if cached:
            # Self-healing cache: if page 0 cached 'Playlists for You' has less than 6 items, bypass cache!
            p_sec = next((s for s in cached.get('sections', []) if s.get('title') == 'Playlists for You'), None)
            if page != 0 or (p_sec and len(p_sec.get('items', [])) >= 6):
                return jsonify(cached)

    sections = []
    is_auth = os.path.exists(AUTH_FILE)

    if page == 0:
        playlists = []
        quick_picks = []
        recommended_music = []
        
        # 1. Fetch from YT Music home page first (personalized content)
        try:
            home = ytmusic.get_home(limit=15)
            for section in home:
                title = section.get('title', '')
                contents = section.get('contents', [])
                if not contents:
                    continue
                
                title_lower = title.lower()
                if "recently played" in title_lower or "history" in title_lower:
                    print(f"[Sonart Server] Filtering out native YouTube Music section: '{title}'")
                    continue
                
                # Check if it contains playlists or songs
                first_item = contents[0] if contents else {}
                is_playlist_section = 'playlistId' in first_item and 'videoId' not in first_item
                
                if is_playlist_section:
                    for item in contents:
                        p_id = item.get('playlistId')
                        if p_id and not any(x['id'] == p_id for x in playlists):
                            playlists.append({
                                'id': p_id,
                                'title': item.get('title', 'Playlist'),
                                'description': item.get('description', 'YouTube Music Playlist'),
                                'artwork': get_artwork_url(item),
                                'trackCount': None
                            })
                else:
                    # Song tracks section
                    title_lower = title.lower()
                    if "quick picks" in title_lower or "listen again" in title_lower or "mixed" in title_lower or not quick_picks:
                        # Append to quick picks
                        for item in contents:
                            t = format_track(item)
                            if t and not any(x['id'] == t['id'] for x in quick_picks):
                                quick_picks.append(t)
                    else:
                        # Append to recommended music
                        for item in contents:
                            t = format_track(item)
                            if t and not any(x['id'] == t['id'] for x in recommended_music):
                                recommended_music.append(t)
        except Exception as e:
            print(f"[Sonart Server] get_home extraction error: {e}", file=sys.stderr)

        # 2. Fallbacks for Playlists (limit is 25 if refreshing to allow shuffling, else 6)
        limit_playlists = 25 if refresh else 6

        # Fallback A: User's own library playlists
        if len(playlists) < limit_playlists and is_auth:
            try:
                lib_playlists = ytmusic.get_library_playlists(limit=20 if refresh else 10)
                for p in lib_playlists:
                    p_id = p.get('playlistId')
                    if p_id and not any(x['id'] == p_id for x in playlists):
                        playlists.append({
                            'id': p_id,
                            'title': p.get('title'),
                            'description': p.get('description', 'Library Playlist'),
                            'artwork': get_artwork_url(p),
                            'trackCount': p.get('count')
                        })
                        if len(playlists) >= limit_playlists:
                            break
            except Exception:
                pass
                
        # Fallback B: Mood / category playlists
        if len(playlists) < limit_playlists:
            try:
                moods = ytmusic.get_mood_categories()
                mood_cats = []
                if moods:
                    for cat_group, items in moods.items():
                        mood_cats.extend(items)
                
                sliced_cats = [c for c in mood_cats if c.get('params')][:6 if refresh else 3]
                for cat in sliced_cats:
                    if len(playlists) >= limit_playlists:
                        break
                    try:
                        cat_playlists = ytmusic.get_mood_playlists(cat['params'])
                        for p in cat_playlists:
                            p_id = p.get('playlistId')
                            if p_id and not any(x['id'] == p_id for x in playlists):
                                playlists.append({
                                    'id': p_id,
                                    'title': p.get('title'),
                                    'description': p.get('subtitle', 'Mood Playlist'),
                                    'artwork': get_artwork_url(p),
                                    'trackCount': None
                                })
                                if len(playlists) >= limit_playlists:
                                    break
                    except Exception:
                        pass
            except Exception:
                pass

        # If refresh is true, randomly shuffle the playlists so they change on every refresh!
        if refresh:
            import random
            random.shuffle(playlists)

        # 3. Fallbacks for Quick Picks (if < 16)
        if len(quick_picks) < 16:
            try:
                charts = ytmusic.get_charts(country="US")
                songs = charts.get('songs', {}).get('items', []) if isinstance(charts, dict) else []
                formatted_charts = format_tracks(songs)
                for t in formatted_charts:
                    if not any(x['id'] == t['id'] for x in quick_picks):
                        quick_picks.append(t)
                        if len(quick_picks) >= 16:
                            break
            except Exception:
                pass

        # 4. Fallbacks for Recommended Music (if < 16)
        if len(recommended_music) < 16:
            # First, check if seed exists and fetch recommendations from it
            if seed:
                try:
                    watch_data = ytmusic.get_watch_playlist(videoId=seed, limit=25)
                    watch_tracks = format_tracks(watch_data.get('tracks', []))
                    for t in watch_tracks:
                        if not any(x['id'] == t['id'] for x in recommended_music) and not any(x['id'] == t['id'] for x in quick_picks):
                            recommended_music.append(t)
                            if len(recommended_music) >= 16:
                                break
                except Exception:
                    pass
            
            # If still < 16, try charts/videos fallback
            if len(recommended_music) < 16:
                try:
                    recs = ytmusic.search("recommended songs", filter="songs")
                    formatted_recs = format_tracks(recs)
                    for t in formatted_recs:
                        if not any(x['id'] == t['id'] for x in recommended_music) and not any(x['id'] == t['id'] for x in quick_picks):
                            recommended_music.append(t)
                            if len(recommended_music) >= 16:
                                break
                except Exception:
                    pass

        # 5. Fetch 10 Recommended Community Playlists
        recommended_playlists = []
        search_queries = []
        
        # If seed_title is available, try it as the prime search query
        if seed_title:
            search_queries.append(seed_title)
            
        # Add fallback highly successful public playlist terms
        search_queries.extend(["chill music", "lofi chill vibe", "top hits playlist", "sad rap mood"])
        
        for q in search_queries:
            if len(recommended_playlists) >= 10:
                break
            try:
                print(f"[Sonart Server] Fetching community playlists for query: '{q}'")
                pl_results = ytmusic.search(q, filter="playlists", limit=15)
                for item in pl_results:
                    p_id = item.get('playlistId')
                    if p_id and not any(x['id'] == p_id for x in recommended_playlists):
                        recommended_playlists.append({
                            'id': p_id,
                            'title': item.get('title', 'Community Playlist'),
                            'description': item.get('description', 'User Curated Community Playlist'),
                            'artwork': get_artwork_url(item),
                            'trackCount': item.get('count')
                        })
                        if len(recommended_playlists) >= 10:
                            break
            except Exception as e:
                print(f"[Sonart Server] Error searching community playlists for query '{q}': {e}", file=sys.stderr)

        # 6. Build exactly the requested layout sections in order!
        if playlists:
            sections.append({
                'title': 'Playlists for You',
                'type': 'playlists',
                'items': playlists[:6]
            })
        if quick_picks:
            sections.append({
                'title': 'Quick Picks',
                'type': 'tracks',
                'items': quick_picks[:16]
            })
        if recommended_music:
            sections.append({
                'title': 'Recommended Music',
                'type': 'tracks',
                'items': recommended_music[:16]
            })
        if recommended_playlists:
            sections.append({
                'title': 'Recommended Playlists',
                'type': 'playlists',
                'items': recommended_playlists[:10]
            })

    # 3. Quick Mix / Mood playlists (Paged)
    try:
        mood_cats = cache_get('mood_categories_list')
        if not mood_cats:
            moods = ytmusic.get_mood_categories()
            mood_cats = []
            if moods:
                for cat_group, items in moods.items():
                    mood_cats.extend(items)
                cache_set('mood_categories_list', mood_cats, ttl=86400) # Cache categories for 1 day

        if mood_cats:
            # We fetch 2 moods for page 0, and 3 moods per page for page 1+
            if page == 0:
                start_idx = 0
                count = 0
            else:
                start_idx = 2 + (page - 1) * 3
                count = 3

            sliced_cats = [c for c in mood_cats if c.get('params')][start_idx:start_idx + count]
            for cat in sliced_cats:
                try:
                    cat_playlists = ytmusic.get_mood_playlists(cat['params'])
                    if cat_playlists:
                        pl_items = []
                        for p in cat_playlists[:8]:
                            pl_items.append({
                                'id': p.get('playlistId', ''),
                                'title': p.get('title', ''),
                                'description': p.get('subtitle', ''),
                                'artwork': get_artwork_url(p),
                                'trackCount': None
                            })
                        if pl_items:
                            sections.append({
                                'title': cat.get('title', 'Mood'),
                                'type': 'playlists',
                                'items': pl_items
                            })
                except Exception:
                    pass
    except Exception as e:
        print(f"[Sonart Server] Moods error: {e}", file=sys.stderr)

    result = {
        'sections': sections,
        'page': page,
        'has_more': (page < 6)
    }
    cache_set(cache_key, result)
    return jsonify(result)

# ── PLAYLIST ENDPOINTS ─────────────────────────────────────────────

def ensure_authenticated():
    global ytmusic
    if os.path.exists(AUTH_FILE):
        from ytmusicapi.ytmusic import AuthType
        if getattr(ytmusic, 'auth_type', None) == AuthType.UNAUTHORIZED:
            try:
                ytmusic = YTMusic(AUTH_FILE)
                print("[Sonart Server] Authenticated YTMusic dynamically re-initialized.")
            except Exception as e:
                print(f"[Sonart Server] Failed to dynamically load auth file: {e}", file=sys.stderr)

# ── PLAYLIST ENDPOINTS ─────────────────────────────────────────────

@app.route('/library/liked', methods=['GET'])
def library_liked():
    ensure_authenticated()
    if not os.path.exists(AUTH_FILE):
        return jsonify({'error': 'Not authenticated', 'tracks': []}), 401
    try:
        playlist = ytmusic.get_liked_songs(limit=100)
        tracks = format_tracks(playlist.get('tracks', []))
        return jsonify({'tracks': tracks})
    except Exception as e:
        print(f"[Sonart Server] Fetch liked songs error: {e}", file=sys.stderr)
        return jsonify({'error': str(e)}), 500

@app.route('/library/playlists', methods=['GET'])
def library_playlists():
    ensure_authenticated()
    if not os.path.exists(AUTH_FILE):
        return jsonify({'error': 'Not authenticated', 'playlists': []}), 401
    try:
        playlists = ytmusic.get_library_playlists()
        result = []
        for p in playlists:
            result.append({
                'id': p.get('playlistId'),
                'title': p.get('title'),
                'description': p.get('description', ''),
                'trackCount': p.get('count'),
                'artwork': get_artwork_url(p)
            })
        return jsonify({'playlists': result})
    except Exception as e:
        print(f"[Sonart Server] Fetch library playlists error: {e}", file=sys.stderr)
        return jsonify({'error': str(e)}), 500

@app.route('/playlist/<playlist_id>', methods=['GET'])
def get_playlist(playlist_id):
    if playlist_id.startswith('VL'):
        playlist_id = playlist_id[2:]
    cache_key = f'playlist_{playlist_id}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify(cached)
    try:
        playlist = ytmusic.get_playlist(playlist_id, limit=200)
        tracks = format_tracks(playlist.get('tracks', []))
        result = {
            'id': playlist.get('id'),
            'title': playlist.get('title'),
            'description': playlist.get('description', ''),
            'artwork': get_artwork_url(playlist),
            'tracks': tracks
        }
        cache_set(cache_key, result)
        return jsonify(result)
    except Exception as e:
        print(f"[Sonart Server] Fetch playlist error: {e}", file=sys.stderr)
        return jsonify({'error': str(e)}), 500

@app.route('/playlist/import', methods=['GET'])
def import_playlist():
    url_or_id = request.args.get('url_or_id', '')
    p_id = parse_playlist_id(url_or_id)
    if not p_id:
        return jsonify({'error': 'Invalid playlist URL or ID'}), 400
    return get_playlist(p_id)

@app.route('/playlist/<playlist_id>/add', methods=['POST'])
def add_to_playlist(playlist_id):
    ensure_authenticated()
    if not os.path.exists(AUTH_FILE):
        return jsonify({'error': 'Not authenticated with YouTube Music'}), 401
    
    try:
        req_data = request.get_json() or {}
        video_id = req_data.get('video_id', '')
        if not video_id:
            return jsonify({'error': 'Missing video_id'}), 400
            
        print(f"[Sonart Server] Adding video '{video_id}' to remote playlist '{playlist_id}'...")
        
        # Clear server cache for this playlist so the next fetch retrieves the fresh list
        cache_key = f'playlist_{playlist_id}'
        with _cache_lock:
            if cache_key in _cache:
                del _cache[cache_key]
                
        # Call ytmusicapi
        res = ytmusic.add_playlist_items(playlistId=playlist_id, videoIds=[video_id])
        return jsonify({'success': True, 'response': res})
    except Exception as e:
        print(f"[Sonart Server] Add to playlist error: {e}", file=sys.stderr)
        return jsonify({'error': str(e)}), 500

@app.route('/playlist/<playlist_id>/remove', methods=['POST'])
def remove_from_playlist(playlist_id):
    ensure_authenticated()
    if not os.path.exists(AUTH_FILE):
        return jsonify({'error': 'Not authenticated with YouTube Music'}), 401
        
    try:
        req_data = request.get_json() or {}
        video_id = req_data.get('video_id', '')
        set_video_id = req_data.get('set_video_id', '')
        
        if not video_id:
            return jsonify({'error': 'Missing video_id'}), 400
            
        print(f"[Sonart Server] Removing video '{video_id}' (setVideoId: {set_video_id}) from remote playlist '{playlist_id}'...")
        
        # Clear server cache for this playlist so the next fetch retrieves the fresh list
        cache_key = f'playlist_{playlist_id}'
        with _cache_lock:
            if cache_key in _cache:
                del _cache[cache_key]
                
        # Call ytmusicapi
        song_item = {"videoId": video_id}
        if set_video_id:
            song_item["setVideoId"] = set_video_id
            
        res = ytmusic.remove_playlist_items(playlistId=playlist_id, songs=[song_item])
        return jsonify({'success': True, 'response': res})
    except Exception as e:
        print(f"[Sonart Server] Remove from playlist error: {e}", file=sys.stderr)
        return jsonify({'error': str(e)}), 500

# ── WATCH PLAYLIST (Radio / Up Next) ──────────────────────────────

@app.route('/radio', methods=['GET'])
def radio():
    """Get a radio/watch playlist seeded from a videoId (song recommendations)."""
    video_id = request.args.get('id', '')
    if not video_id:
        return jsonify({'error': 'Missing id'}), 400

    cache_key = f'radio_{video_id}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify(cached)

    try:
        watch = ytmusic.get_watch_playlist(videoId=video_id, limit=25)
        tracks = format_tracks(watch.get('tracks', []))
        result = {'tracks': tracks}
        cache_set(cache_key, result)
        return jsonify(result)
    except Exception as e:
        print(f"[Sonart Server] Radio error: {e}", file=sys.stderr)
        return jsonify({'error': str(e)}), 500

# ── GENERAL ENDPOINTS ──────────────────────────────────────────────

@app.route('/trending', methods=['GET'])
def trending():
    cached = cache_get('trending')
    if cached:
        return jsonify({'data': cached})
    try:
        charts = ytmusic.get_charts(country="US")
        songs = charts.get('songs', {}).get('items', [])

        if not songs:
            results = ytmusic.search("trending", filter="songs")
            songs = results[:20]

        tracks = format_tracks(songs)
        cache_set('trending', tracks)
        return jsonify({'data': tracks})
    except Exception as e:
        print(f"[Sonart Server] Trending error: {e}", file=sys.stderr)
        return jsonify({'error': str(e)}), 500

@app.route('/search', methods=['GET'])
def search():
    query = request.args.get('q', '')
    if not query:
        return jsonify({'data': []})

    cache_key = f'search_{query}'
    cached = cache_get(cache_key)
    if cached:
        print(f"[Sonart Server] Search cache HIT for '{query}': {len(cached)} items")
        return jsonify({'data': cached})

    try:
        print(f"[Sonart Server] Search API request for '{query}'...")
        results = ytmusic.search(query, filter="songs")
        print(f"[Sonart Server] Search API raw results count: {len(results)}")
        tracks = format_tracks(results)
        print(f"[Sonart Server] Search API formatted tracks count: {len(tracks)}")
        cache_set(cache_key, tracks)
        return jsonify({'data': tracks})
    except Exception as e:
        print(f"[Sonart Server] Search error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/stream', methods=['GET'])
def stream():
    video_id = request.args.get('id', '')
    if not video_id:
        return "Missing id", 400

    cache_key = f'stream_{video_id}'
    cached = cache_get(cache_key)
    if cached:
        return redirect(cached)

    try:
        ydl_opts = {
            'format': 'bestaudio/best',
            'quiet': True,
            'no_warnings': True,
            'http_headers': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
            }
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
            stream_url = info['url']
            cache_set(cache_key, stream_url, ttl=14400) # Cache direct stream for 4 hours
            return redirect(stream_url)
    except Exception as e:
        print(f"[Sonart Server] Stream error: {e}", file=sys.stderr)
        return str(e), 500

@app.route('/auth/clear-cache', methods=['POST'])
def clear_server_cache():
    try:
        with _cache_lock:
            _cache.clear()
        print("[Sonart Server] Server cache flushed.")
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

import re
import urllib.request

def parse_lrc(lrc_text):
    if not lrc_text:
        return []
    
    lines = []
    # Match timestamps like [01:23.45] or [01:23.456] or [01:23]
    timestamp_re = re.compile(r'\[(\d+):(\d+(?:\.\d+)?)\]')
    
    for line in lrc_text.splitlines():
        line = line.strip()
        if not line:
            continue
        
        # Find all timestamps in the line
        matches = list(timestamp_re.finditer(line))
        if not matches:
            continue
        
        # Extract the lyric text (which is after the last timestamp match)
        last_match = matches[-1]
        lyric_text = line[last_match.end():].strip()
        
        for m in matches:
            minutes = int(m.group(1))
            seconds = float(m.group(2))
            total_seconds = minutes * 60 + seconds
            lines.append({
                'time': total_seconds,
                'text': lyric_text
            })
            
    # Sort lines by timestamp
    lines.sort(key=lambda x: x['time'])
    return lines

@app.route('/lyrics', methods=['GET'])
def get_lyrics():
    video_id = request.args.get('id', '')
    title = request.args.get('title', '')
    artist = request.args.get('artist', '')
    duration_str = request.args.get('duration', '0')
    
    if not video_id:
        return jsonify({'error': 'Missing id'}), 400

    cache_key = f'lyrics_{video_id}'
    cached = cache_get(cache_key)
    if cached:
        return jsonify(cached)

    # 1. Try fetching from LRCLIB first
    if not title or not artist:
        try:
            # Fallback metadata extraction using ytmusic
            watch = ytmusic.get_watch_playlist(videoId=video_id)
            tracks = watch.get('tracks', [])
            if tracks:
                t = tracks[0]
                title = t.get('title', '')
                artists = t.get('artists', [])
                artist = ", ".join([a.get('name') for a in artists if a.get('name')]) if artists else ""
                duration_str = str(t.get('duration_seconds', '0'))
        except Exception as e:
            print(f"[Sonart Server] Watch playlist metadata extraction failed: {e}", file=sys.stderr)

    if title and artist:
        try:
            # Let's clean the title from youtube noise
            clean_title = re.sub(r'\s*[\(\[][fF]eat\..*?[\)\]]', '', title) # Remove feat.
            clean_title = re.sub(r'\s*[\(\[][oO]fficial\s+.*?[\]\)]', '', clean_title) # Remove Official Video/Audio
            clean_title = re.sub(r'\s*[\(\[][lL]yrics?.*?[\)\]]', '', clean_title) # Remove Lyrics/Lyric Video
            clean_title = clean_title.strip()
            
            # Prepare search params
            params = {
                'artist_name': artist,
                'track_name': clean_title
            }
            try:
                duration_val = int(float(duration_str))
                if duration_val > 0:
                    params['duration'] = duration_val
            except ValueError:
                pass
                
            url = 'https://lrclib.net/api/get?' + urlparse.urlencode(params)
            print(f"[Sonart Server] Querying LRCLIB: {url}")
            
            req = urllib.request.Request(
                url, 
                headers={'User-Agent': 'Sonart Music Player (https://github.com/Sonart/SonartWindows)'}
            )
            with urllib.request.urlopen(req, timeout=4) as response:
                lrclib_data = json.loads(response.read().decode('utf-8'))
                
                # Check if it has synced lyrics
                if lrclib_data.get('syncedLyrics'):
                    parsed_lines = parse_lrc(lrclib_data['syncedLyrics'])
                    if parsed_lines:
                        res = {
                            'synced': True,
                            'lines': parsed_lines,
                            'source': 'LRCLIB (Synced)'
                        }
                        cache_set(cache_key, res)
                        return jsonify(res)
                
                # Check if it has plain lyrics in LRCLIB as a backup
                if lrclib_data.get('plainLyrics'):
                    res = {
                        'synced': False,
                        'lyrics': lrclib_data['plainLyrics'],
                        'source': 'LRCLIB (Plain)'
                    }
                    cache_set(cache_key, res)
                    return jsonify(res)
                    
        except Exception as e:
            print(f"[Sonart Server] LRCLIB query failed or returned no match: {e}", file=sys.stderr)

    # 2. Fall back to standard YouTube Music lyrics
    try:
        watch = ytmusic.get_watch_playlist(videoId=video_id)
        lyrics_browse_id = watch.get('lyrics')
        if not lyrics_browse_id:
            res = {'synced': False, 'lyrics': 'Lyrics not found for this track.', 'source': None}
            cache_set(cache_key, res)
            return jsonify(res)

        lyrics_data = ytmusic.get_lyrics(lyrics_browse_id)
        lyrics_text = lyrics_data.get('lyrics', 'Lyrics not found for this track.')
        lyrics_source = lyrics_data.get('source', '')
        
        res = {'synced': False, 'lyrics': lyrics_text, 'source': f"{lyrics_source} (via YTMusic)" if lyrics_source else "YouTube Music"}
        cache_set(cache_key, res)
        return jsonify(res)
    except Exception as e:
        print(f"[Sonart Server] YouTube Music lyrics fallback failed: {e}", file=sys.stderr)
        return jsonify({'synced': False, 'lyrics': 'Could not load lyrics. Please try again.', 'error': str(e)}), 500

if __name__ == '__main__':
    app.run(port=18492, host='127.0.0.1')
