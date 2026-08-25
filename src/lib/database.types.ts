export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          actor_id: string
          actor_role: Database["public"]["Enums"]["user_role"]
          created_at: string
          diff: Json | null
          entity_id: string
          entity_type: string
          id: string
          ip_address: unknown
        }
        Insert: {
          action: string
          actor_id: string
          actor_role: Database["public"]["Enums"]["user_role"]
          created_at?: string
          diff?: Json | null
          entity_id: string
          entity_type: string
          id?: string
          ip_address?: unknown
        }
        Update: {
          action?: string
          actor_id?: string
          actor_role?: Database["public"]["Enums"]["user_role"]
          created_at?: string
          diff?: Json | null
          entity_id?: string
          entity_type?: string
          id?: string
          ip_address?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      booster_admin_notes: {
        Row: {
          booster_id: string
          note: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          booster_id: string
          note?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          booster_id?: string
          note?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booster_admin_notes_booster_id_fkey"
            columns: ["booster_id"]
            isOneToOne: true
            referencedRelation: "booster_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booster_admin_notes_booster_id_fkey"
            columns: ["booster_id"]
            isOneToOne: true
            referencedRelation: "public_booster_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booster_admin_notes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      booster_champion_stats: {
        Row: {
          account_type: string
          booster_id: string
          calculated_at: string
          champion: string
          games_played: number
          id: string
          wins: number
        }
        Insert: {
          account_type?: string
          booster_id: string
          calculated_at?: string
          champion: string
          games_played?: number
          id?: string
          wins?: number
        }
        Update: {
          account_type?: string
          booster_id?: string
          calculated_at?: string
          champion?: string
          games_played?: number
          id?: string
          wins?: number
        }
        Relationships: [
          {
            foreignKeyName: "booster_champion_stats_booster_id_fkey"
            columns: ["booster_id"]
            isOneToOne: false
            referencedRelation: "booster_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "booster_champion_stats_booster_id_fkey"
            columns: ["booster_id"]
            isOneToOne: false
            referencedRelation: "public_booster_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      booster_duo_matches: {
        Row: {
          assists: number
          booster_id: string
          champion: string | null
          created_at: string
          deaths: number
          duration_seconds: number | null
          external_match_id: string
          id: string
          is_mvp: boolean
          kills: number
          minions_killed: number | null
          neutral_minions_killed: number | null
          order_id: string
          played_at: string
          queue_id: number | null
          result: string
          vision_score: number | null
        }
        Insert: {
          assists?: number
          booster_id: string
          champion?: string | null
          created_at?: string
          deaths?: number
          duration_seconds?: number | null
          external_match_id: string
          id?: string
          is_mvp?: boolean
          kills?: number
          minions_killed?: number | null
          neutral_minions_killed?: number | null
          order_id: string
          played_at: string
          queue_id?: number | null
          result: string
          vision_score?: number | null
        }
        Update: {
          assists?: number
          booster_id?: string
          champion?: string | null
          created_at?: string
          deaths?: number
          duration_seconds?: number | null
          external_match_id?: string
          id?: string
          is_mvp?: boolean
          kills?: number
          minions_killed?: number | null
          neutral_minions_killed?: number | null
          order_id?: string
          played_at?: string
          queue_id?: number | null
          result?: string
          vision_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "booster_duo_matches_booster_id_fkey"
            columns: ["booster_id"]
            isOneToOne: false
            referencedRelation: "booster_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "booster_duo_matches_booster_id_fkey"
            columns: ["booster_id"]
            isOneToOne: false
            referencedRelation: "public_booster_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "booster_duo_matches_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "available_boost_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booster_duo_matches_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      booster_ledger_entries: {
        Row: {
          actor_id: string | null
          actor_role: Database["public"]["Enums"]["user_role"] | null
          amount: number
          booster_id: string
          correlation_id: string
          created_at: string
          description: string | null
          entry_type: Database["public"]["Enums"]["ledger_entry_type"]
          id: string
          metadata: Json
          order_id: string | null
          payout_request_id: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["user_role"] | null
          amount: number
          booster_id: string
          correlation_id?: string
          created_at?: string
          description?: string | null
          entry_type: Database["public"]["Enums"]["ledger_entry_type"]
          id?: string
          metadata?: Json
          order_id?: string | null
          payout_request_id?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["user_role"] | null
          amount?: number
          booster_id?: string
          correlation_id?: string
          created_at?: string
          description?: string | null
          entry_type?: Database["public"]["Enums"]["ledger_entry_type"]
          id?: string
          metadata?: Json
          order_id?: string | null
          payout_request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booster_ledger_entries_booster_id_fkey"
            columns: ["booster_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booster_ledger_entries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "available_boost_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booster_ledger_entries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booster_ledger_entries_payout_request_id_fkey"
            columns: ["payout_request_id"]
            isOneToOne: false
            referencedRelation: "payout_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      booster_order_events: {
        Row: {
          created_at: string
          id: number
          order_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          order_id: string
        }
        Update: {
          created_at?: string
          id?: never
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booster_order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "available_boost_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booster_order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      booster_performance_segments: {
        Row: {
          account_type: string
          adjusted_rating: number
          adjusted_win_rate: number
          average_kda: number | null
          average_rating: number | null
          avg_cs_per_min: number | null
          avg_vision_score: number | null
          booster_id: string
          calculated_at: string
          id: string
          last_match_at: string | null
          losses: number
          mvp_count: number
          normalized_kda: number
          performance_score: number
          queue_type: string
          rank_bucket: string
          review_count: number
          score_version: string
          service_type: string
          total_matches: number
          updated_at: string
          wins: number
        }
        Insert: {
          account_type?: string
          adjusted_rating?: number
          adjusted_win_rate?: number
          average_kda?: number | null
          average_rating?: number | null
          avg_cs_per_min?: number | null
          avg_vision_score?: number | null
          booster_id: string
          calculated_at?: string
          id?: string
          last_match_at?: string | null
          losses?: number
          mvp_count?: number
          normalized_kda?: number
          performance_score?: number
          queue_type?: string
          rank_bucket?: string
          review_count?: number
          score_version?: string
          service_type?: string
          total_matches?: number
          updated_at?: string
          wins?: number
        }
        Update: {
          account_type?: string
          adjusted_rating?: number
          adjusted_win_rate?: number
          average_kda?: number | null
          average_rating?: number | null
          avg_cs_per_min?: number | null
          avg_vision_score?: number | null
          booster_id?: string
          calculated_at?: string
          id?: string
          last_match_at?: string | null
          losses?: number
          mvp_count?: number
          normalized_kda?: number
          performance_score?: number
          queue_type?: string
          rank_bucket?: string
          review_count?: number
          score_version?: string
          service_type?: string
          total_matches?: number
          updated_at?: string
          wins?: number
        }
        Relationships: [
          {
            foreignKeyName: "booster_performance_segments_booster_id_fkey"
            columns: ["booster_id"]
            isOneToOne: false
            referencedRelation: "booster_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "booster_performance_segments_booster_id_fkey"
            columns: ["booster_id"]
            isOneToOne: false
            referencedRelation: "public_booster_profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      booster_profile_events: {
        Row: {
          booster_id: string
          created_at: string
          id: number
        }
        Insert: {
          booster_id: string
          created_at?: string
          id?: never
        }
        Update: {
          booster_id?: string
          created_at?: string
          id?: never
        }
        Relationships: []
      }
      booster_profiles: {
        Row: {
          available_days: string[] | null
          bio: string | null
          cpf: string | null
          created_at: string
          current_rank: Json | null
          display_name: string
          display_name_changed_at: string | null
          email: string | null
          full_name: string | null
          games: string[]
          hours_per_day_max: number | null
          hours_per_day_min: number | null
          id: string
          is_top3: boolean
          lanes: string[] | null
          last_active_at: string | null
          opgg_link: string | null
          opgg_link_visible: boolean
          peak_rank: Json | null
          queue_preferences: string[]
          rating: number
          rating_count: number
          region_preferences: string[]
          specialties: string[] | null
          status: Database["public"]["Enums"]["booster_status"]
          suspended_until: string | null
          total_completed: number
          total_earnings: number
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          available_days?: string[] | null
          bio?: string | null
          cpf?: string | null
          created_at?: string
          current_rank?: Json | null
          display_name: string
          display_name_changed_at?: string | null
          email?: string | null
          full_name?: string | null
          games?: string[]
          hours_per_day_max?: number | null
          hours_per_day_min?: number | null
          id?: string
          is_top3?: boolean
          lanes?: string[] | null
          last_active_at?: string | null
          opgg_link?: string | null
          opgg_link_visible?: boolean
          peak_rank?: Json | null
          queue_preferences?: string[]
          rating?: number
          rating_count?: number
          region_preferences?: string[]
          specialties?: string[] | null
          status?: Database["public"]["Enums"]["booster_status"]
          suspended_until?: string | null
          total_completed?: number
          total_earnings?: number
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          available_days?: string[] | null
          bio?: string | null
          cpf?: string | null
          created_at?: string
          current_rank?: Json | null
          display_name?: string
          display_name_changed_at?: string | null
          email?: string | null
          full_name?: string | null
          games?: string[]
          hours_per_day_max?: number | null
          hours_per_day_min?: number | null
          id?: string
          is_top3?: boolean
          lanes?: string[] | null
          last_active_at?: string | null
          opgg_link?: string | null
          opgg_link_visible?: boolean
          peak_rank?: Json | null
          queue_preferences?: string[]
          rating?: number
          rating_count?: number
          region_preferences?: string[]
          specialties?: string[] | null
          status?: Database["public"]["Enums"]["booster_status"]
          suspended_until?: string | null
          total_completed?: number
          total_earnings?: number
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booster_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      booster_services: {
        Row: {
          availability_note: string | null
          booster_id: string
          champions: string[] | null
          created_at: string | null
          deleted_at: string | null
          description: string
          id: string
          is_active: boolean
          lanes: string[] | null
          price: number
          requirements: string | null
          rules: string | null
          service_type: string | null
          specialties: string[] | null
          tempo: string
          title: string
          unit: string
          updated_at: string
        }
        Insert: {
          availability_note?: string | null
          booster_id: string
          champions?: string[] | null
          created_at?: string | null
          deleted_at?: string | null
          description: string
          id?: string
          is_active?: boolean
          lanes?: string[] | null
          price?: number
          requirements?: string | null
          rules?: string | null
          service_type?: string | null
          specialties?: string[] | null
          tempo: string
          title: string
          unit?: string
          updated_at?: string
        }
        Update: {
          availability_note?: string | null
          booster_id?: string
          champions?: string[] | null
          created_at?: string | null
          deleted_at?: string | null
          description?: string
          id?: string
          is_active?: boolean
          lanes?: string[] | null
          price?: number
          requirements?: string | null
          rules?: string | null
          service_type?: string | null
          specialties?: string[] | null
          tempo?: string
          title?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booster_services_booster_id_fkey"
            columns: ["booster_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_profiles: {
        Row: {
          country: string | null
          created_at: string
          display_name: string | null
          id: string
          preferred_language: string | null
          total_orders: number
          total_spent: number
          user_id: string
        }
        Insert: {
          country?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          preferred_language?: string | null
          total_orders?: number
          total_spent?: number
          user_id: string
        }
        Update: {
          country?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          preferred_language?: string | null
          total_orders?: number
          total_spent?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      duo_account_events: {
        Row: {
          account_id: string
          created_at: string
          id: number
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: never
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: never
        }
        Relationships: []
      }
      duo_account_reservations: {
        Row: {
          account_id: string
          booster_id: string
          id: string
          order_id: string | null
          released_at: string | null
          released_by: string | null
          reserved_at: string
        }
        Insert: {
          account_id: string
          booster_id: string
          id?: string
          order_id?: string | null
          released_at?: string | null
          released_by?: string | null
          reserved_at?: string
        }
        Update: {
          account_id?: string
          booster_id?: string
          id?: string
          order_id?: string | null
          released_at?: string | null
          released_by?: string | null
          reserved_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "duo_account_reservations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "duo_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "duo_account_reservations_booster_id_fkey"
            columns: ["booster_id"]
            isOneToOne: false
            referencedRelation: "booster_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "duo_account_reservations_booster_id_fkey"
            columns: ["booster_id"]
            isOneToOne: false
            referencedRelation: "public_booster_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "duo_account_reservations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "available_boost_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "duo_account_reservations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "duo_account_reservations_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      duo_accounts: {
        Row: {
          access_token_consumed_at: string | null
          access_token_expires_at: string | null
          access_token_id: string | null
          created_at: string
          created_by: string | null
          current_rank: Json | null
          encrypted_credentials: string | null
          game_id: string
          id: string
          is_active: boolean
          label: string
          last_released_at: string | null
          last_released_by: string | null
          notes: string | null
          reserved_at: string | null
          reserved_by: string | null
          reserved_order_id: string | null
          riot_id: string | null
          updated_at: string
        }
        Insert: {
          access_token_consumed_at?: string | null
          access_token_expires_at?: string | null
          access_token_id?: string | null
          created_at?: string
          created_by?: string | null
          current_rank?: Json | null
          encrypted_credentials?: string | null
          game_id?: string
          id?: string
          is_active?: boolean
          label: string
          last_released_at?: string | null
          last_released_by?: string | null
          notes?: string | null
          reserved_at?: string | null
          reserved_by?: string | null
          reserved_order_id?: string | null
          riot_id?: string | null
          updated_at?: string
        }
        Update: {
          access_token_consumed_at?: string | null
          access_token_expires_at?: string | null
          access_token_id?: string | null
          created_at?: string
          created_by?: string | null
          current_rank?: Json | null
          encrypted_credentials?: string | null
          game_id?: string
          id?: string
          is_active?: boolean
          label?: string
          last_released_at?: string | null
          last_released_by?: string | null
          notes?: string | null
          reserved_at?: string | null
          reserved_by?: string | null
          reserved_order_id?: string | null
          riot_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "duo_accounts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "duo_accounts_last_released_by_fkey"
            columns: ["last_released_by"]
            isOneToOne: false
            referencedRelation: "booster_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "duo_accounts_last_released_by_fkey"
            columns: ["last_released_by"]
            isOneToOne: false
            referencedRelation: "public_booster_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "duo_accounts_reserved_by_fkey"
            columns: ["reserved_by"]
            isOneToOne: false
            referencedRelation: "booster_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "duo_accounts_reserved_by_fkey"
            columns: ["reserved_by"]
            isOneToOne: false
            referencedRelation: "public_booster_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "duo_accounts_reserved_order_id_fkey"
            columns: ["reserved_order_id"]
            isOneToOne: false
            referencedRelation: "available_boost_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "duo_accounts_reserved_order_id_fkey"
            columns: ["reserved_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      edge_rate_limits: {
        Row: {
          request_count: number
          scope: string
          subject: string
          window_started_at: string
        }
        Insert: {
          request_count: number
          scope: string
          subject: string
          window_started_at: string
        }
        Update: {
          request_count?: number
          scope?: string
          subject?: string
          window_started_at?: string
        }
        Relationships: []
      }
      games: {
        Row: {
          icon_url: string | null
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          icon_url?: string | null
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
        }
        Update: {
          icon_url?: string | null
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      master_plus_pricing: {
        Row: {
          current_tier: string
          id: string
          pdl_from: number
          price: number | null
          queue_type: Database["public"]["Enums"]["queue_type"]
          target_tier: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          current_tier: string
          id?: string
          pdl_from: number
          price?: number | null
          queue_type: Database["public"]["Enums"]["queue_type"]
          target_tier: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          current_tier?: string
          id?: string
          pdl_from?: number
          price?: number | null
          queue_type?: Database["public"]["Enums"]["queue_type"]
          target_tier?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          data: Json
          id: string
          is_read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          data?: Json
          id?: string
          is_read?: boolean
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          data?: Json
          id?: string
          is_read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      order_coaching_topics: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          content: string
          created_at: string
          created_by: string
          created_by_role: Database["public"]["Enums"]["user_role"]
          id: string
          is_done: boolean
          order_id: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          content: string
          created_at?: string
          created_by: string
          created_by_role: Database["public"]["Enums"]["user_role"]
          id?: string
          is_done?: boolean
          order_id: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          content?: string
          created_at?: string
          created_by?: string
          created_by_role?: Database["public"]["Enums"]["user_role"]
          id?: string
          is_done?: boolean
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_coaching_topics_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_coaching_topics_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_coaching_topics_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "available_boost_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_coaching_topics_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_drop_requests: {
        Row: {
          admin_id: string | null
          admin_note: string | null
          booster_id: string
          created_at: string
          id: string
          losses_at_request: number
          order_id: string
          penalty_amount: number
          penalty_pct: number
          reason: string
          requested_by_role: Database["public"]["Enums"]["drop_requester_role"]
          resolved_at: string | null
          status: string
          status_at_request: Database["public"]["Enums"]["order_status"] | null
          wins_at_request: number
        }
        Insert: {
          admin_id?: string | null
          admin_note?: string | null
          booster_id: string
          created_at?: string
          id?: string
          losses_at_request?: number
          order_id: string
          penalty_amount?: number
          penalty_pct?: number
          reason: string
          requested_by_role?: Database["public"]["Enums"]["drop_requester_role"]
          resolved_at?: string | null
          status?: string
          status_at_request?: Database["public"]["Enums"]["order_status"] | null
          wins_at_request?: number
        }
        Update: {
          admin_id?: string | null
          admin_note?: string | null
          booster_id?: string
          created_at?: string
          id?: string
          losses_at_request?: number
          order_id?: string
          penalty_amount?: number
          penalty_pct?: number
          reason?: string
          requested_by_role?: Database["public"]["Enums"]["drop_requester_role"]
          resolved_at?: string | null
          status?: string
          status_at_request?: Database["public"]["Enums"]["order_status"] | null
          wins_at_request?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_drop_requests_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_drop_requests_booster_id_fkey"
            columns: ["booster_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_drop_requests_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "available_boost_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_drop_requests_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_matches: {
        Row: {
          assists: number
          champion: string | null
          created_at: string
          deaths: number
          duration_seconds: number | null
          external_match_id: string
          id: string
          is_mvp: boolean
          kills: number
          minions_killed: number | null
          neutral_minions_killed: number | null
          order_id: string
          played_at: string
          queue_id: number | null
          result: string
          vision_score: number | null
        }
        Insert: {
          assists?: number
          champion?: string | null
          created_at?: string
          deaths?: number
          duration_seconds?: number | null
          external_match_id: string
          id?: string
          is_mvp?: boolean
          kills?: number
          minions_killed?: number | null
          neutral_minions_killed?: number | null
          order_id: string
          played_at: string
          queue_id?: number | null
          result: string
          vision_score?: number | null
        }
        Update: {
          assists?: number
          champion?: string | null
          created_at?: string
          deaths?: number
          duration_seconds?: number | null
          external_match_id?: string
          id?: string
          is_mvp?: boolean
          kills?: number
          minions_killed?: number | null
          neutral_minions_killed?: number | null
          order_id?: string
          played_at?: string
          queue_id?: number | null
          result?: string
          vision_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_matches_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "available_boost_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_matches_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_messages: {
        Row: {
          attachment_url: string | null
          content: string
          created_at: string
          id: string
          is_read: boolean
          order_id: string
          sender_id: string
          sender_role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          attachment_url?: string | null
          content: string
          created_at?: string
          id?: string
          is_read?: boolean
          order_id: string
          sender_id: string
          sender_role: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          attachment_url?: string | null
          content?: string
          created_at?: string
          id?: string
          is_read?: boolean
          order_id?: string
          sender_id?: string
          sender_role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: [
          {
            foreignKeyName: "order_messages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "available_boost_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_messages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      order_rank_verifications: {
        Row: {
          created_at: string
          error_reason: string | null
          fetched_division: string | null
          fetched_lp: number | null
          fetched_tier: string | null
          id: string
          order_id: string
          passed: boolean
          requested_by: string
          riot_id_checked: string
          target_division: string | null
          target_tier: string
        }
        Insert: {
          created_at?: string
          error_reason?: string | null
          fetched_division?: string | null
          fetched_lp?: number | null
          fetched_tier?: string | null
          id?: string
          order_id: string
          passed: boolean
          requested_by: string
          riot_id_checked: string
          target_division?: string | null
          target_tier: string
        }
        Update: {
          created_at?: string
          error_reason?: string | null
          fetched_division?: string | null
          fetched_lp?: number | null
          fetched_tier?: string | null
          id?: string
          order_id?: string
          passed?: boolean
          requested_by?: string
          riot_id_checked?: string
          target_division?: string | null
          target_tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_rank_verifications_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "available_boost_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_rank_verifications_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_rank_verifications_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_events: {
        Row: {
          created_at: string
          id: number
          order_id: string
          status: Database["public"]["Enums"]["order_status"]
        }
        Insert: {
          created_at?: string
          id?: never
          order_id: string
          status: Database["public"]["Enums"]["order_status"]
        }
        Update: {
          created_at?: string
          id?: never
          order_id?: string
          status?: Database["public"]["Enums"]["order_status"]
        }
        Relationships: [
          {
            foreignKeyName: "order_status_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "available_boost_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_status_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_history: {
        Row: {
          changed_by: string
          created_at: string
          from_status: Database["public"]["Enums"]["order_status"] | null
          id: string
          order_id: string
          reason: string | null
          to_status: Database["public"]["Enums"]["order_status"]
        }
        Insert: {
          changed_by: string
          created_at?: string
          from_status?: Database["public"]["Enums"]["order_status"] | null
          id?: string
          order_id: string
          reason?: string | null
          to_status: Database["public"]["Enums"]["order_status"]
        }
        Update: {
          changed_by?: string
          created_at?: string
          from_status?: Database["public"]["Enums"]["order_status"] | null
          id?: string
          order_id?: string
          reason?: string | null
          to_status?: Database["public"]["Enums"]["order_status"]
        }
        Relationships: [
          {
            foreignKeyName: "order_status_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_status_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "available_boost_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_status_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_support_escalations: {
        Row: {
          customer_id: string
          deadline_at: string
          delay_minutes: number
          id: string
          order_id: string
          requested_at: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          customer_id: string
          deadline_at: string
          delay_minutes: number
          id?: string
          order_id: string
          requested_at?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          customer_id?: string
          deadline_at?: string
          delay_minutes?: number
          id?: string
          order_id?: string
          requested_at?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_support_escalations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_support_escalations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "available_boost_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_support_escalations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_support_escalations_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          access_token_consumed_at: string | null
          access_token_expires_at: string | null
          access_token_id: string | null
          assigned_booster_id: string | null
          avg_pdl_gain: number | null
          avg_pdl_loss: number | null
          base_price: number
          boost_mode: string
          booster_notes: string | null
          booster_service_id: string | null
          chat_locked: boolean
          chat_locked_at: string | null
          chat_locked_by: string | null
          clash_day: Database["public"]["Enums"]["clash_day"] | null
          clash_tier: Database["public"]["Enums"]["clash_tier"] | null
          completed_at: string | null
          coupon_code: string | null
          created_at: string
          credential_expires_at: string | null
          credentials_set: boolean
          current_pdl: number | null
          current_rank: Json | null
          customer_id: string
          customer_lanes: string[] | null
          customer_notes: string | null
          discord_text_channel_id: string | null
          discord_voice_channel_id: string | null
          discount_price: number
          drop_count: number
          duo_own_riot_id: string | null
          estimated_hours: number | null
          exclusive_until: string | null
          extras: Json
          extras_price: number
          game_credentials: string | null
          game_id: string
          id: string
          idempotency_key: string
          last_dropped_at: string | null
          last_match_synced_at: string | null
          losses_played: number
          match_sync_started_at: string | null
          md5_matches_remaining: number | null
          mp_payment_id: string | null
          payment_status: Database["public"]["Enums"]["payment_status"] | null
          pdl_bracket: string | null
          preferred_booster_id: string | null
          pricing_version: string
          queue_type: Database["public"]["Enums"]["queue_type"]
          rank_before_last_drop: Json | null
          riot_id: string | null
          server: string
          service_id: string
          service_type: Database["public"]["Enums"]["service_type"]
          sessions_purchased: number | null
          status: Database["public"]["Enums"]["order_status"]
          target_rank: Json | null
          total_price: number
          updated_at: string
          used_exclusive_slot: boolean
          win_package: number | null
          wins_played: number
          wins_purchased: number | null
        }
        Insert: {
          access_token_consumed_at?: string | null
          access_token_expires_at?: string | null
          access_token_id?: string | null
          assigned_booster_id?: string | null
          avg_pdl_gain?: number | null
          avg_pdl_loss?: number | null
          base_price: number
          boost_mode?: string
          booster_notes?: string | null
          booster_service_id?: string | null
          chat_locked?: boolean
          chat_locked_at?: string | null
          chat_locked_by?: string | null
          clash_day?: Database["public"]["Enums"]["clash_day"] | null
          clash_tier?: Database["public"]["Enums"]["clash_tier"] | null
          completed_at?: string | null
          coupon_code?: string | null
          created_at?: string
          credential_expires_at?: string | null
          credentials_set?: boolean
          current_pdl?: number | null
          current_rank?: Json | null
          customer_id: string
          customer_lanes?: string[] | null
          customer_notes?: string | null
          discord_text_channel_id?: string | null
          discord_voice_channel_id?: string | null
          discount_price?: number
          drop_count?: number
          duo_own_riot_id?: string | null
          estimated_hours?: number | null
          exclusive_until?: string | null
          extras?: Json
          extras_price?: number
          game_credentials?: string | null
          game_id: string
          id?: string
          idempotency_key?: string
          last_dropped_at?: string | null
          last_match_synced_at?: string | null
          losses_played?: number
          match_sync_started_at?: string | null
          md5_matches_remaining?: number | null
          mp_payment_id?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"] | null
          pdl_bracket?: string | null
          preferred_booster_id?: string | null
          pricing_version?: string
          queue_type?: Database["public"]["Enums"]["queue_type"]
          rank_before_last_drop?: Json | null
          riot_id?: string | null
          server: string
          service_id: string
          service_type: Database["public"]["Enums"]["service_type"]
          sessions_purchased?: number | null
          status?: Database["public"]["Enums"]["order_status"]
          target_rank?: Json | null
          total_price: number
          updated_at?: string
          used_exclusive_slot?: boolean
          win_package?: number | null
          wins_played?: number
          wins_purchased?: number | null
        }
        Update: {
          access_token_consumed_at?: string | null
          access_token_expires_at?: string | null
          access_token_id?: string | null
          assigned_booster_id?: string | null
          avg_pdl_gain?: number | null
          avg_pdl_loss?: number | null
          base_price?: number
          boost_mode?: string
          booster_notes?: string | null
          booster_service_id?: string | null
          chat_locked?: boolean
          chat_locked_at?: string | null
          chat_locked_by?: string | null
          clash_day?: Database["public"]["Enums"]["clash_day"] | null
          clash_tier?: Database["public"]["Enums"]["clash_tier"] | null
          completed_at?: string | null
          coupon_code?: string | null
          created_at?: string
          credential_expires_at?: string | null
          credentials_set?: boolean
          current_pdl?: number | null
          current_rank?: Json | null
          customer_id?: string
          customer_lanes?: string[] | null
          customer_notes?: string | null
          discord_text_channel_id?: string | null
          discord_voice_channel_id?: string | null
          discount_price?: number
          drop_count?: number
          duo_own_riot_id?: string | null
          estimated_hours?: number | null
          exclusive_until?: string | null
          extras?: Json
          extras_price?: number
          game_credentials?: string | null
          game_id?: string
          id?: string
          idempotency_key?: string
          last_dropped_at?: string | null
          last_match_synced_at?: string | null
          losses_played?: number
          match_sync_started_at?: string | null
          md5_matches_remaining?: number | null
          mp_payment_id?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"] | null
          pdl_bracket?: string | null
          preferred_booster_id?: string | null
          pricing_version?: string
          queue_type?: Database["public"]["Enums"]["queue_type"]
          rank_before_last_drop?: Json | null
          riot_id?: string | null
          server?: string
          service_id?: string
          service_type?: Database["public"]["Enums"]["service_type"]
          sessions_purchased?: number | null
          status?: Database["public"]["Enums"]["order_status"]
          target_rank?: Json | null
          total_price?: number
          updated_at?: string
          used_exclusive_slot?: boolean
          win_package?: number | null
          wins_played?: number
          wins_purchased?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_assigned_booster_id_fkey"
            columns: ["assigned_booster_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_booster_service_id_fkey"
            columns: ["booster_service_id"]
            isOneToOne: false
            referencedRelation: "booster_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_chat_locked_by_fkey"
            columns: ["chat_locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_preferred_booster_id_fkey"
            columns: ["preferred_booster_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          customer_id: string
          id: string
          metadata: Json
          mp_payment_id: string
          order_id: string
          payment_method_type: string | null
          refunded_amount: number
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
          webhook_event_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          customer_id: string
          id?: string
          metadata?: Json
          mp_payment_id: string
          order_id: string
          payment_method_type?: string | null
          refunded_amount?: number
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
          webhook_event_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          customer_id?: string
          id?: string
          metadata?: Json
          mp_payment_id?: string
          order_id?: string
          payment_method_type?: string | null
          refunded_amount?: number
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
          webhook_event_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "available_boost_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_records: {
        Row: {
          booster_id: string
          commission_amount: number
          commission_rate: number
          created_at: string
          gross_amount: number
          id: string
          net_amount: number
          order_id: string
          paid_at: string | null
          status: Database["public"]["Enums"]["payout_status"]
        }
        Insert: {
          booster_id: string
          commission_amount: number
          commission_rate?: number
          created_at?: string
          gross_amount: number
          id?: string
          net_amount: number
          order_id: string
          paid_at?: string | null
          status?: Database["public"]["Enums"]["payout_status"]
        }
        Update: {
          booster_id?: string
          commission_amount?: number
          commission_rate?: number
          created_at?: string
          gross_amount?: number
          id?: string
          net_amount?: number
          order_id?: string
          paid_at?: string | null
          status?: Database["public"]["Enums"]["payout_status"]
        }
        Relationships: [
          {
            foreignKeyName: "payout_records_booster_id_fkey"
            columns: ["booster_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_records_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "available_boost_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_records_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_requests: {
        Row: {
          admin_note: string | null
          amount: number
          booster_cpf_snapshot: string | null
          booster_id: string
          booster_legal_name_snapshot: string | null
          created_at: string
          id: string
          paid_at: string | null
          paid_by: string | null
          proof_url: string | null
          rejection_reason: string | null
          requested_at: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["payout_request_status"]
          updated_at: string
        }
        Insert: {
          admin_note?: string | null
          amount: number
          booster_cpf_snapshot?: string | null
          booster_id: string
          booster_legal_name_snapshot?: string | null
          created_at?: string
          id?: string
          paid_at?: string | null
          paid_by?: string | null
          proof_url?: string | null
          rejection_reason?: string | null
          requested_at?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["payout_request_status"]
          updated_at?: string
        }
        Update: {
          admin_note?: string | null
          amount?: number
          booster_cpf_snapshot?: string | null
          booster_id?: string
          booster_legal_name_snapshot?: string | null
          created_at?: string
          id?: string
          paid_at?: string | null
          paid_by?: string | null
          proof_url?: string | null
          rejection_reason?: string | null
          requested_at?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["payout_request_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_requests_booster_id_fkey"
            columns: ["booster_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_requests_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          discord_id: string | null
          email: string
          id: string
          legal_version: string | null
          privacy_accepted_at: string | null
          role: Database["public"]["Enums"]["user_role"]
          terms_accepted_at: string | null
          updated_at: string
          username: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          discord_id?: string | null
          email: string
          id: string
          legal_version?: string | null
          privacy_accepted_at?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          terms_accepted_at?: string | null
          updated_at?: string
          username: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          discord_id?: string | null
          email?: string
          id?: string
          legal_version?: string | null
          privacy_accepted_at?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          terms_accepted_at?: string | null
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      refunds: {
        Row: {
          amount: number
          created_at: string
          id: string
          initiated_by: string
          is_manual: boolean
          mp_refund_id: string | null
          order_id: string
          payment_id: string | null
          reason: string
          status: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          initiated_by: string
          is_manual?: boolean
          mp_refund_id?: string | null
          order_id: string
          payment_id?: string | null
          reason: string
          status?: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          initiated_by?: string
          is_manual?: boolean
          mp_refund_id?: string | null
          order_id?: string
          payment_id?: string | null
          reason?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "available_boost_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          admin_note: string | null
          booster_id: string | null
          content: string | null
          created_at: string
          customer_id: string
          id: string
          is_moderated: boolean
          is_public: boolean
          order_id: string
          rating: number
        }
        Insert: {
          admin_note?: string | null
          booster_id?: string | null
          content?: string | null
          created_at?: string
          customer_id: string
          id?: string
          is_moderated?: boolean
          is_public?: boolean
          order_id: string
          rating: number
        }
        Update: {
          admin_note?: string | null
          booster_id?: string | null
          content?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          is_moderated?: boolean
          is_public?: boolean
          order_id?: string
          rating?: number
        }
        Relationships: [
          {
            foreignKeyName: "reviews_booster_id_fkey"
            columns: ["booster_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "available_boost_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      riot_league_cutoffs: {
        Row: {
          cutoff_lp: number
          fetched_at: string
          queue: Database["public"]["Enums"]["queue_type"]
          tier: string
        }
        Insert: {
          cutoff_lp: number
          fetched_at?: string
          queue: Database["public"]["Enums"]["queue_type"]
          tier: string
        }
        Update: {
          cutoff_lp?: number
          fetched_at?: string
          queue?: Database["public"]["Enums"]["queue_type"]
          tier?: string
        }
        Relationships: []
      }
      service_extras: {
        Row: {
          code: string | null
          description: string
          flow: string | null
          icon: string | null
          id: string
          is_active: boolean
          name: string
          price_modifier: number
          price_modifier_pct: number
          service_id: string | null
          service_type_overrides: Json
          sort_order: number
        }
        Insert: {
          code?: string | null
          description: string
          flow?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          name: string
          price_modifier?: number
          price_modifier_pct?: number
          service_id?: string | null
          service_type_overrides?: Json
          sort_order?: number
        }
        Update: {
          code?: string | null
          description?: string
          flow?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          name?: string
          price_modifier?: number
          price_modifier_pct?: number
          service_id?: string | null
          service_type_overrides?: Json
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "service_extras_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          description: string | null
          game_id: string
          id: string
          is_active: boolean
          name: string
          short_description: string | null
          sort_order: number
          type: Database["public"]["Enums"]["service_type"]
        }
        Insert: {
          description?: string | null
          game_id: string
          id?: string
          is_active?: boolean
          name: string
          short_description?: string | null
          sort_order?: number
          type: Database["public"]["Enums"]["service_type"]
        }
        Update: {
          description?: string | null
          game_id?: string
          id?: string
          is_active?: boolean
          name?: string
          short_description?: string | null
          sort_order?: number
          type?: Database["public"]["Enums"]["service_type"]
        }
        Relationships: [
          {
            foreignKeyName: "services_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      available_boost_orders: {
        Row: {
          avg_pdl_gain: number | null
          avg_pdl_loss: number | null
          boost_mode: string | null
          clash_day: Database["public"]["Enums"]["clash_day"] | null
          clash_tier: Database["public"]["Enums"]["clash_tier"] | null
          created_at: string | null
          current_pdl: number | null
          current_rank: Json | null
          customer_lanes: string[] | null
          drop_count: number | null
          estimated_hours: number | null
          exclusive_until: string | null
          extras: Json | null
          game_id: string | null
          id: string | null
          last_dropped_at: string | null
          losses_played: number | null
          pdl_bracket: string | null
          preferred_booster_id: string | null
          pricing_version: string | null
          queue_type: Database["public"]["Enums"]["queue_type"] | null
          rank_before_last_drop: Json | null
          server: string | null
          service_id: string | null
          service_type: Database["public"]["Enums"]["service_type"] | null
          sessions_purchased: number | null
          status: Database["public"]["Enums"]["order_status"] | null
          target_rank: Json | null
          total_price: number | null
          updated_at: string | null
          win_package: number | null
          wins_played: number | null
          wins_purchased: number | null
        }
        Insert: {
          avg_pdl_gain?: number | null
          avg_pdl_loss?: number | null
          boost_mode?: string | null
          clash_day?: Database["public"]["Enums"]["clash_day"] | null
          clash_tier?: Database["public"]["Enums"]["clash_tier"] | null
          created_at?: string | null
          current_pdl?: number | null
          current_rank?: Json | null
          customer_lanes?: string[] | null
          drop_count?: number | null
          estimated_hours?: number | null
          exclusive_until?: string | null
          extras?: Json | null
          game_id?: string | null
          id?: string | null
          last_dropped_at?: string | null
          losses_played?: number | null
          pdl_bracket?: string | null
          preferred_booster_id?: string | null
          pricing_version?: string | null
          queue_type?: Database["public"]["Enums"]["queue_type"] | null
          rank_before_last_drop?: Json | null
          server?: string | null
          service_id?: string | null
          service_type?: Database["public"]["Enums"]["service_type"] | null
          sessions_purchased?: number | null
          status?: Database["public"]["Enums"]["order_status"] | null
          target_rank?: Json | null
          total_price?: number | null
          updated_at?: string | null
          win_package?: number | null
          wins_played?: number | null
          wins_purchased?: number | null
        }
        Update: {
          avg_pdl_gain?: number | null
          avg_pdl_loss?: number | null
          boost_mode?: string | null
          clash_day?: Database["public"]["Enums"]["clash_day"] | null
          clash_tier?: Database["public"]["Enums"]["clash_tier"] | null
          created_at?: string | null
          current_pdl?: number | null
          current_rank?: Json | null
          customer_lanes?: string[] | null
          drop_count?: number | null
          estimated_hours?: number | null
          exclusive_until?: string | null
          extras?: Json | null
          game_id?: string | null
          id?: string | null
          last_dropped_at?: string | null
          losses_played?: number | null
          pdl_bracket?: string | null
          preferred_booster_id?: string | null
          pricing_version?: string | null
          queue_type?: Database["public"]["Enums"]["queue_type"] | null
          rank_before_last_drop?: Json | null
          server?: string | null
          service_id?: string | null
          service_type?: Database["public"]["Enums"]["service_type"] | null
          sessions_purchased?: number | null
          status?: Database["public"]["Enums"]["order_status"] | null
          target_rank?: Json | null
          total_price?: number | null
          updated_at?: string | null
          win_package?: number | null
          wins_played?: number | null
          wins_purchased?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_preferred_booster_id_fkey"
            columns: ["preferred_booster_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      public_booster_profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          current_rank: Json | null
          display_name: string | null
          games: string[] | null
          id: string | null
          is_top3: boolean | null
          lanes: string[] | null
          last_active_at: string | null
          opgg_link: string | null
          peak_rank: Json | null
          rating: number | null
          rating_count: number | null
          specialties: string[] | null
          total_completed: number | null
          updated_at: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booster_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_boost_order: {
        Args: { p_booster_user_id: string; p_order_id: string }
        Returns: Json
      }
      add_order_coaching_topic: {
        Args: { p_content: string; p_order_id: string }
        Returns: Json
      }
      admin_create_manual_refund: {
        Args: { p_amount: number; p_order_id: string; p_reason: string }
        Returns: Json
      }
      admin_dashboard_stats: { Args: never; Returns: Json }
      admin_drop_order: {
        Args: { p_order_id: string; p_reason: string }
        Returns: Json
      }
      admin_mark_payout_paid: {
        Args: { p_proof_url: string; p_request_id: string }
        Returns: Json
      }
      admin_override_order_status: {
        Args: { p_new_status: string; p_order_id: string; p_reason?: string }
        Returns: Json
      }
      admin_release_duo_account: {
        Args: { p_account_id: string }
        Returns: Json
      }
      admin_resolve_order_support: {
        Args: { p_escalation_id: string }
        Returns: Json
      }
      admin_review_payout_request: {
        Args: { p_new_status: string; p_note?: string; p_request_id: string }
        Returns: Json
      }
      admin_set_order_chat_lock: {
        Args: { p_locked: boolean; p_order_id: string }
        Returns: Json
      }
      apply_order_drop:
        | {
            Args: {
              p_actor_id: string
              p_from_status: string
              p_order_id: string
              p_reason: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_actor_id: string
              p_from_status: string
              p_order_id: string
              p_reason: string
              p_target_status?: string
            }
            Returns: Json
          }
      approve_booster: {
        Args: { p_booster_id: string; p_new_status: string }
        Returns: Json
      }
      booster_active_slot_counts: {
        Args: { p_booster_user_id: string }
        Returns: {
          duo_count: number
          solo_count: number
          total_count: number
        }[]
      }
      booster_available_balance: {
        Args: { p_booster_id: string }
        Returns: number
      }
      booster_display_name_cooldown_days_remaining: {
        Args: { p_user_id: string }
        Returns: number
      }
      booster_has_active_exclusive_slot: {
        Args: { p_booster_user_id: string }
        Returns: boolean
      }
      booster_heartbeat: { Args: never; Returns: undefined }
      booster_payout_summary: {
        Args: { p_booster_user_id: string }
        Returns: Json
      }
      booster_payout_totals: { Args: { p_booster_id: string }; Returns: Json }
      can_booster_accept_order: {
        Args: {
          p_boost_mode: string
          p_booster_user_id: string
          p_service_type?: string
        }
        Returns: Json
      }
      cancel_payout_request: { Args: { p_request_id: string }; Returns: Json }
      cancel_pending_order_payment: {
        Args: { p_customer_id: string; p_order_id: string }
        Returns: Json
      }
      check_own_write_rate_limit: {
        Args: { p_limit: number; p_scope: string; p_window_seconds: number }
        Returns: boolean
      }
      clear_duo_own_riot_id: { Args: { p_order_id: string }; Returns: Json }
      complete_verified_order: {
        Args: {
          p_fetched_division: string
          p_fetched_tier: string
          p_order_id: string
          p_requested_by: string
        }
        Returns: Json
      }
      confirm_order_completion: { Args: { p_order_id: string }; Returns: Json }
      consume_edge_rate_limit: {
        Args: {
          p_limit: number
          p_scope: string
          p_subject: string
          p_window_seconds: number
        }
        Returns: Json
      }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      delete_duo_account: { Args: { p_account_id: string }; Returns: Json }
      dispute_order_completion: {
        Args: { p_order_id: string; p_reason: string }
        Returns: Json
      }
      duo_account_rank_is_valid: { Args: { p_rank: Json }; Returns: boolean }
      ensure_profile_exists: {
        Args: { p_display_name?: string }
        Returns: undefined
      }
      expel_booster: {
        Args: { p_actor_id: string; p_booster_id: string; p_reason: string }
        Returns: Json
      }
      expire_stale_booster_suspensions: { Args: never; Returns: undefined }
      expire_stale_pix_orders: { Args: never; Returns: undefined }
      get_customer_order_state: { Args: { p_order_id?: string }; Returns: Json }
      get_duo_account_access_token: {
        Args: { p_account_id: string }
        Returns: Json
      }
      get_duo_account_credentials: {
        Args: { p_account_id: string }
        Returns: Json
      }
      get_duo_account_reservation_history: {
        Args: { p_account_id: string }
        Returns: Json
      }
      get_order_chat: { Args: { p_order_id: string }; Returns: Json }
      get_order_chat_mention_targets: {
        Args: { p_order_id: string }
        Returns: Json
      }
      get_order_credentials: { Args: { p_order_id: string }; Returns: Json }
      get_order_customer_nickname: {
        Args: { p_order_id: string }
        Returns: string
      }
      get_order_duo_account_history: {
        Args: { p_order_id: string }
        Returns: Json
      }
      get_order_duo_partner_riot_id: {
        Args: { p_order_id: string }
        Returns: string
      }
      get_public_booster_reviews: {
        Args: { p_booster_id: string }
        Returns: {
          content: string
          created_at: string
          customer_nickname: string
          id: string
          rating: number
          service_type: string
        }[]
      }
      get_top_boosters: {
        Args: {
          p_limit?: number
          p_rank_bucket?: string
          p_service_type?: string
        }
        Returns: Json
      }
      is_admin: { Args: never; Returns: boolean }
      is_approved_booster:
        | { Args: never; Returns: boolean }
        | { Args: { p_booster_id: string }; Returns: boolean }
      list_duo_accounts: { Args: never; Returns: Json }
      mark_order_chat_read: { Args: { p_order_id: string }; Returns: Json }
      mark_order_match_sync: { Args: { p_order_id: string }; Returns: Json }
      onboard_booster: {
        Args: {
          p_available_days?: string[]
          p_bio: string
          p_cpf?: string
          p_display_name: string
          p_full_name?: string
          p_hours_per_day_max?: number
          p_hours_per_day_min?: number
          p_opgg_link?: string
          p_peak_rank: Json
        }
        Returns: Json
      }
      order_drop_completion_pct: {
        Args: { p_order_id: string }
        Returns: number
      }
      order_requires_access_token: {
        Args: {
          p_boost_mode: string
          p_service_type: Database["public"]["Enums"]["service_type"]
        }
        Returns: boolean
      }
      payout_request_order_breakdown: {
        Args: { p_request_id: string }
        Returns: {
          amount_included: number
          booster_commission: number
          commission_rate: number
          gross_amount: number
          order_id: string
          service_type: Database["public"]["Enums"]["service_type"]
        }[]
      }
      process_mp_payment_event: {
        Args: {
          p_amount: number
          p_currency: string
          p_event_id: string
          p_mp_payment_id: string
          p_order_id: string
          p_provider_status: string
          p_refund_id?: string
        }
        Returns: Json
      }
      rank_bucket_of: { Args: { p_tier: string }; Returns: string }
      rank_step: {
        Args: { p_division: string; p_tier: string }
        Returns: number
      }
      record_order_match: {
        Args: {
          p_assists: number
          p_champion: string
          p_deaths: number
          p_duration_seconds: number
          p_external_match_id: string
          p_is_mvp: boolean
          p_kills: number
          p_minions_killed: number
          p_neutral_minions_killed: number
          p_order_id: string
          p_played_at: string
          p_queue_id: number
          p_result: string
          p_vision_score: number
        }
        Returns: Json
      }
      record_pix_payment: {
        Args: {
          p_amount: number
          p_customer_id: string
          p_mp_payment_id: string
          p_order_id: string
        }
        Returns: Json
      }
      refresh_booster_performance_segments: {
        Args: { p_booster_id?: string }
        Returns: undefined
      }
      refresh_booster_rating: {
        Args: { p_booster_id: string }
        Returns: undefined
      }
      refresh_top3_boosters: { Args: never; Returns: undefined }
      release_duo_account_reservation: {
        Args: { p_order_id: string }
        Returns: Json
      }
      request_booster_role: { Args: never; Returns: Json }
      request_customer_order_drop: {
        Args: { p_order_id: string; p_reason: string }
        Returns: Json
      }
      request_order_drop: {
        Args: { p_order_id: string; p_reason: string }
        Returns: Json
      }
      request_order_support: { Args: { p_order_id: string }; Returns: Json }
      request_payout: { Args: { p_amount: number }; Returns: Json }
      reserve_duo_account: {
        Args: { p_account_id: string; p_order_id: string }
        Returns: Json
      }
      resolve_drop_request: {
        Args: {
          p_admin_note?: string
          p_approve: boolean
          p_request_id: string
        }
        Returns: Json
      }
      resolve_duo_account_access_token: {
        Args: { p_access_token: string; p_booster_user_id: string }
        Returns: Json
      }
      resolve_order_access_token: {
        Args: { p_access_token: string; p_booster_user_id: string }
        Returns: Json
      }
      save_duo_account: {
        Args: {
          p_account_id?: string
          p_division: string
          p_is_active: boolean
          p_label: string
          p_login?: string
          p_notes?: string
          p_password?: string
          p_riot_id?: string
          p_tier: string
        }
        Returns: Json
      }
      send_order_message: {
        Args: {
          p_content: string
          p_mentioned_user_ids?: string[]
          p_order_id: string
        }
        Returns: Json
      }
      set_booster_admin_note: {
        Args: { p_booster_id: string; p_note: string }
        Returns: Json
      }
      set_duo_account_active: {
        Args: { p_account_id: string; p_is_active: boolean }
        Returns: Json
      }
      set_duo_account_credentials: {
        Args: { p_account_id: string; p_login: string; p_password: string }
        Returns: Json
      }
      set_duo_own_riot_id: {
        Args: { p_order_id: string; p_riot_id: string }
        Returns: Json
      }
      set_order_coaching_topic_done: {
        Args: { p_done: boolean; p_order_id: string; p_topic_id: string }
        Returns: Json
      }
      set_order_credentials: {
        Args: { p_login: string; p_order_id: string; p_password: string }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      update_booster_professional_profile: {
        Args: {
          p_available_days: string[]
          p_bio: string
          p_display_name: string
          p_hours_per_day_max: number
          p_hours_per_day_min: number
          p_opgg_link: string
          p_opgg_link_visible: boolean
          p_peak_tier: string
        }
        Returns: Json
      }
      update_duo_account_rank: {
        Args: { p_account_id: string; p_division: string; p_tier: string }
        Returns: Json
      }
      update_my_display_name: {
        Args: { p_display_name: string }
        Returns: Json
      }
      update_my_username: { Args: { p_username: string }; Returns: Json }
      update_order_current_rank: {
        Args: {
          p_division: string
          p_lp: number
          p_order_id: string
          p_tier: string
        }
        Returns: Json
      }
      update_order_status: {
        Args: { p_new_status: string; p_order_id: string; p_reason?: string }
        Returns: Json
      }
    }
    Enums: {
      booster_status:
        | "pending"
        | "under_review"
        | "approved"
        | "suspended"
        | "rejected"
        | "removed"
      clash_day: "saturday" | "sunday"
      clash_tier: "tier_4" | "tier_3" | "tier_2" | "tier_1"
      drop_requester_role: "booster" | "admin" | "customer"
      ledger_entry_type:
        | "commission_credit"
        | "commission_adjustment"
        | "drop_penalty"
        | "refund_debit"
        | "manual_admin_adjustment"
        | "payout_reservation"
        | "payout_release"
        | "payout_paid"
      order_status:
        | "draft"
        | "awaiting_payment"
        | "paid"
        | "awaiting_assignment"
        | "assigned"
        | "in_progress"
        | "paused"
        | "drop_requested"
        | "awaiting_customer"
        | "completed"
        | "disputed"
        | "refunded"
        | "canceled"
      payment_status:
        | "pending"
        | "paid"
        | "failed"
        | "refunded"
        | "partially_refunded"
        | "disputed"
      payout_request_status:
        | "requested"
        | "under_review"
        | "approved"
        | "paid"
        | "rejected"
        | "canceled"
      payout_status: "pending" | "processing" | "paid" | "failed"
      queue_type: "solo_duo" | "flex"
      service_type:
        | "elo_boost"
        | "win_boost"
        | "coaching"
        | "placement_matches"
        | "md5"
        | "clash"
      user_role: "customer" | "booster" | "admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      booster_status: [
        "pending",
        "under_review",
        "approved",
        "suspended",
        "rejected",
        "removed",
      ],
      clash_day: ["saturday", "sunday"],
      clash_tier: ["tier_4", "tier_3", "tier_2", "tier_1"],
      drop_requester_role: ["booster", "admin", "customer"],
      ledger_entry_type: [
        "commission_credit",
        "commission_adjustment",
        "drop_penalty",
        "refund_debit",
        "manual_admin_adjustment",
        "payout_reservation",
        "payout_release",
        "payout_paid",
      ],
      order_status: [
        "draft",
        "awaiting_payment",
        "paid",
        "awaiting_assignment",
        "assigned",
        "in_progress",
        "paused",
        "drop_requested",
        "awaiting_customer",
        "completed",
        "disputed",
        "refunded",
        "canceled",
      ],
      payment_status: [
        "pending",
        "paid",
        "failed",
        "refunded",
        "partially_refunded",
        "disputed",
      ],
      payout_request_status: [
        "requested",
        "under_review",
        "approved",
        "paid",
        "rejected",
        "canceled",
      ],
      payout_status: ["pending", "processing", "paid", "failed"],
      queue_type: ["solo_duo", "flex"],
      service_type: [
        "elo_boost",
        "win_boost",
        "coaching",
        "placement_matches",
        "md5",
        "clash",
      ],
      user_role: ["customer", "booster", "admin"],
    },
  },
} as const
