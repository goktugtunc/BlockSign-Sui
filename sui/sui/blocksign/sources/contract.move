module blocksign::contract {
    /// 1 SUI = 1_000_000_000 MIST
    /// Ücret: 0.002 SUI
    const FIVE_SUI_MIST: u64 = 2_000_000;

    /// Ödemelerin biriktiği kasa (shared)
    public struct Treasury has key {
        id: sui::object::UID,
        vault: sui::balance::Balance<0x2::sui::SUI>,
    }

    /// Kullanıcı -> oluşturduğu doküman ID’leri (shared)
    public struct Registry has key {
        id: sui::object::UID,
        by_user: sui::table::Table<address, vector<sui::object::ID>>,
    }

    /// Sözleşme dokümanı (shared)
    public struct Document has key {
        id: sui::object::UID,
        /// Event’lerde rahat kullanım için önbelleklenmiş ID
        doc_id: sui::object::ID,
        owner: address,
        file_hash: vector<u8>,
        signers: vector<address>,
        signed: vector<address>,
        canceled: bool,
    }

    public struct CreatedEvent  has copy, drop { doc: sui::object::ID, owner: address }
    public struct SignedEvent   has copy, drop { doc: sui::object::ID, signer: address }
    public struct CanceledEvent has copy, drop { doc: sui::object::ID, by: address }
    public struct RejectedEvent has copy, drop { doc: sui::object::ID, by: address }

    /// Kurulum: Treasury + Registry oluştur ve paylaştır (bir kez çağır)
    public fun setup(ctx: &mut sui::tx_context::TxContext) {
        let t = Treasury {
            id: sui::object::new(ctx),
            vault: sui::balance::zero(),
        };
        let r = Registry {
            id: sui::object::new(ctx),
            by_user: sui::table::new<address, vector<sui::object::ID>>(ctx),
        };
        sui::transfer::share_object(t);
        sui::transfer::share_object(r);
    }

    /// create_contract: 0.002 SUI ücreti kes + Document yarat + Registry güncelle
    public fun create_contract(
        treasury: &mut Treasury,
        registry: &mut Registry,
        file_hash: vector<u8>,
        signers: vector<address>,
        // Kalan coin çağıranda kalır; sadece 0.002’lik parça ayrılır.
        payment: &mut sui::coin::Coin<0x2::sui::SUI>,
        ctx: &mut sui::tx_context::TxContext
    ) {
        // Sadece 0.002 SUI'yi ayır. Yetersiz bakiye varsa split abort eder.
        let fee_coin = sui::coin::split<0x2::sui::SUI>(payment, FIVE_SUI_MIST, ctx);
        let fee_bal  = sui::coin::into_balance(fee_coin);
        sui::balance::join(&mut treasury.vault, fee_bal);

        // Document oluştur (UID'den ID'yi çıkarıp cache’le)
        let who = sui::tx_context::sender(ctx);
        let uid = sui::object::new(ctx);
        let did = sui::object::uid_to_inner(&uid);
        let doc = Document {
            id: uid,
            doc_id: did,
            owner: who,
            file_hash,
            signers,
            signed: std::vector::empty<address>(),
            canceled: false,
        };

        // Event + paylaş
        sui::event::emit(CreatedEvent { doc: did, owner: who });
        sui::transfer::share_object(doc);

        // Registry: idempotent ekle
        if (!sui::table::contains(&registry.by_user, who)) {
            sui::table::add(&mut registry.by_user, who, std::vector::empty<sui::object::ID>());
        };
        let v = sui::table::borrow_mut(&mut registry.by_user, who);
        if (!contains_id(v, &did)) {
            std::vector::push_back<sui::object::ID>(v, did);
        };
    }

    /// sign: sadece yetkili imzacı ve canceled=false iken
    public fun sign(doc: &mut Document, ctx: &mut sui::tx_context::TxContext) {
        assert!(!doc.canceled, 2);
        let who = sui::tx_context::sender(ctx);
        assert!(contains_addr(&doc.signers, &who), 3);
        assert!(!contains_addr(&doc.signed, &who), 4);
        std::vector::push_back<address>(&mut doc.signed, who);
        sui::event::emit(SignedEvent { doc: doc.doc_id, signer: who });
    }

    /// reject: listedeki herhangi biri reddederse canceled=true
    public fun reject(doc: &mut Document, ctx: &mut sui::tx_context::TxContext) {
        assert!(!doc.canceled, 5);
        let who = sui::tx_context::sender(ctx);
        assert!(contains_addr(&doc.signers, &who), 6);
        doc.canceled = true;
        sui::event::emit(RejectedEvent { doc: doc.doc_id, by: who });
    }

    /// cancel: sadece owner iptal edebilir
    public fun cancel(doc: &mut Document, ctx: &mut sui::tx_context::TxContext) {
        let who = sui::tx_context::sender(ctx);
        assert!(who == doc.owner, 7);
        assert!(!doc.canceled, 8);
        doc.canceled = true;
        sui::event::emit(CanceledEvent { doc: doc.doc_id, by: who });
    }

    /// issign: çağıran imzalamış mı? 1/0
    public fun issign(doc: &Document, ctx: &mut sui::tx_context::TxContext) : u64 {
        let who = sui::tx_context::sender(ctx);
        if (contains_addr(&doc.signed, &who)) { 1 } else { 0 }
    }

    /// iscomplete: tüm imzacılar imzalamış mı? (canceled ise 0)
    public fun iscomplete(doc: &Document) : u64 {
        if (doc.canceled) { return 0 };
        let mut i = 0;
        let n = std::vector::length<address>(&doc.signers);
        while (i < n) {
            let s = *std::vector::borrow<address>(&doc.signers, i);
            if (!contains_addr(&doc.signed, &s)) { return 0 };
            i = i + 1;
        };
        1
    }

    public fun is_active(doc: &Document) : u64 {
        if (doc.canceled) { 0 } else { 1 }
    }

    public fun total_signers(doc: &Document) : u64 {
        std::vector::length<address>(&doc.signers) as u64
    }

    public fun signed_count(doc: &Document) : u64 {
        std::vector::length<address>(&doc.signed) as u64
    }

    /// my_contracts: çağıranın oluşturdukları
    public fun my_contracts(registry: &Registry, ctx: &mut sui::tx_context::TxContext) : vector<sui::object::ID> {
        let who = sui::tx_context::sender(ctx);
        if (sui::table::contains(&registry.by_user, who)) {
            let src = sui::table::borrow(&registry.by_user, who);
            let mut out = std::vector::empty<sui::object::ID>();
            let mut i = 0;
            let n = std::vector::length<sui::object::ID>(src);
            while (i < n) {
                let x = *std::vector::borrow<sui::object::ID>(src, i);
                std::vector::push_back<sui::object::ID>(&mut out, x);
                i = i + 1;
            };
            out
        } else {
            std::vector::empty<sui::object::ID>()
        }
    }

    /// Yardımcılar
    fun contains_addr(v: &vector<address>, a: &address) : bool {
        let mut i = 0;
        let n = std::vector::length<address>(v);
        while (i < n) {
            if (*std::vector::borrow<address>(v, i) == *a) return true;
            i = i + 1;
        };
        false
    }

    fun contains_id(v: &vector<sui::object::ID>, idv: &sui::object::ID) : bool {
        let mut i = 0;
        let n = std::vector::length<sui::object::ID>(v);
        while (i < n) {
            if (*std::vector::borrow<sui::object::ID>(v, i) == *idv) return true;
            i = i + 1;
        };
        false
    }
}
